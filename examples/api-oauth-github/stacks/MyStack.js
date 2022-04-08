import * as sst from "@serverless-stack/resources";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as apigAuthorizers from "@aws-cdk/aws-apigatewayv2-authorizers-alpha";

export default class MyStack extends sst.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // Create auth userpool
    const auth = new sst.Auth(this, "Auth", {
      cognito: true,
    });

    // Create a HTTP API
    const api = new sst.Api(this, "Api", {
      routes: {
        "GET /public": "src/public.handler",
        "GET /user": "src/user.handler",
        "POST /token": "src/token.handler",
      },
    });

    // Create a GitHub OIDC IDP
    const idp = new cognito.CfnUserPoolIdentityProvider(
      this,
      "GitHubIdentityProvider",
      {
        providerName: "GitHub",
        providerType: "OIDC",
        userPoolId: auth.cognitoUserPool.userPoolId,
        providerDetails: {
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          attributes_request_method: "GET",
          oidc_issuer: "https://github.com",
          authorize_scopes: "openid user",
          authorize_url: "https://github.com/login/oauth/authorize",
          token_url: api.url + "/token",
          attributes_url: api.url + "/user",
          jwks_uri: api.url + "/token",
        },
        attributeMapping: {
          email: "email",
          name: "name",
          picture: "avatar_url",
        },
      }
    );

    // Create a Cognito User Pool Client with GitHub OIDC IDP
    const cfnUserPoolClient = new cognito.CfnUserPoolClient(
      this,
      "CognitoAppClient",
      {
        supportedIdentityProviders: ["GitHub"],
        clientName: "GitHubClient",
        allowedOAuthFlowsUserPoolClient: true,
        allowedOAuthFlows: ["code", "implicit"],
        allowedOAuthScopes: [
          "openid",
          "profile",
          "email",
          "aws.cognito.signin.user.admin",
        ],
        explicitAuthFlows: ["ALLOW_REFRESH_TOKEN_AUTH"],
        preventUserExistenceErrors: "ENABLED",
        generateSecret: false,
        refreshTokenValidity: 1,
        callbackUrLs: ["http://localhost:3000"],
        logoutUrLs: ["http://localhost:3000"],
        userPoolId: auth.cognitoUserPool.userPoolId,
      }
    );

    // attach the IDP to the client
    if (idp) {
      cfnUserPoolClient.node.addDependency(idp);
    }

    // create a private API route
    api.addRoutes(this, {
      "GET /private": {
        handler: "src/private.handler",
        authorizer: new apigAuthorizers.HttpUserPoolAuthorizer(
          "Authorizer",
          auth.cognitoUserPool,
          {
            userPoolClients: [cfnUserPoolClient],
          }
        ),
        authorizationType: sst.ApiAuthorizationType.JWT,
      },
    });

    // Create a cognito userpool domain
    const domain = auth.cognitoUserPool.addDomain("AuthDomain", {
      cognitoDomain: {
        domainPrefix: `${scope.stage}-github-demo-oauth-domain`,
      },
    });

    // Allow authenticated users invoke API
    auth.attachPermissionsForAuthUsers([api]);

    // Create a React Static Site
    const site = new sst.ViteStaticSite(this, "Site", {
      path: "frontend",
      environment: {
        VITE_APP_COGNITO_DOMAIN: domain.domainName,
        VITE_APP_API_URL: api.url,
        VITE_APP_REGION: scope.region,
        VITE_APP_USER_POOL_ID: auth.cognitoUserPool.userPoolId,
        VITE_APP_IDENTITY_POOL_ID: auth.cognitoCfnIdentityPool.ref,
        VITE_APP_USER_POOL_CLIENT_ID: cfnUserPoolClient.ref,
      },
    });

    // Show the endpoint in the output
    this.addOutputs({
      ApiEndpoint: api.url,
      authClientId: auth.cognitoUserPoolClient.userPoolClientId,
      domain: domain.domainName,
      site_url: site.url,
    });
  }
}
