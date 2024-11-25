import * as cdk from "aws-cdk-lib";
import * as SSM from "aws-cdk-lib/aws-ssm";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as ApiGateway from "aws-cdk-lib/aws-apigateway";
import type { Construct } from "constructs";

export class ApiGatewayStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

        console.log('this', this)

		const hostedZoneId = SSM.StringParameter.fromStringParameterName(
			this,
			"HostedZoneId",
			"/route53/hosted-zone-id",
		).stringValue;
		const hostedZoneName = SSM.StringParameter.fromStringParameterName(
			this,
			"HostedZoneName",
			"/route53/hosted-zone-name",
		).stringValue;
        const certificateArn = SSM.StringParameter.fromStringParameterName(
			this,
			"CertificateArn",
			`/acm/certificate-arn-${process.env.CDK_DEFAULT_REGION}`,
		).stringValue;

		const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
			this,
			"HostedZone",
			{ hostedZoneId, zoneName: hostedZoneName },
		);

		const certificate = acm.Certificate.fromCertificateArn(
			this,
			"Certificate",
			certificateArn,
		);

		const cvBuilderApiDeployOptions: ApiGateway.StageOptions = {
			stageName: "v1",
		};

		const cvBuilderApiCorsPreflightOptions: ApiGateway.CorsOptions = {
			allowOrigins: [`https://*.${hostedZoneName}`],
			allowMethods: ["GET", "POST", "OPTIONS"],
			allowHeaders: ["Content-Type", "Authorization"],
		};

		const cvBuilderApi = new ApiGateway.RestApi(this, "CvBuilderApi", {
			restApiName: "CvBuilderApi",
			defaultCorsPreflightOptions: cvBuilderApiCorsPreflightOptions,
			deployOptions: cvBuilderApiDeployOptions,
		});

		const cvBuilderDomainName = new ApiGateway.DomainName(
			this,
			"CvBuilderDomainName",
			{
				domainName: `cvbuilder.${hostedZoneName}`,
				certificate,
				endpointType: ApiGateway.EndpointType.REGIONAL,
				securityPolicy: ApiGateway.SecurityPolicy.TLS_1_2,
			},
		);

		new ApiGateway.BasePathMapping(this, "CvBuilderBasePathMapping", {
			domainName: cvBuilderDomainName,
			restApi: cvBuilderApi,
			basePath: cvBuilderApiDeployOptions.stageName,
		});

		const cvBuilderHealth = cvBuilderApi.root.addResource("health");

        const cvBuilderHealthMockIntegration = new ApiGateway.MockIntegration({
            requestTemplates: {
                'application/json': '{"statusCode": 200}'
            },
            integrationResponses: [
                {
                    statusCode: "200",
                    responseTemplates: {
                        "application/json": JSON.stringify({
                            message: "OK",
                            timestamp: "$context.requestTime"
                        }),
                    },
                    responseParameters: {
                        "method.response.header.Access-Control-Allow-Origin": `'https://cvbuilder.${hostedZoneName}'`,
                        "method.response.header.Access-Control-Allow-Methods": "'GET,OPTIONS'",
                        "method.response.header.Access-Control-Allow-Headers": "'Content-Type,Authorization'"
                    }
                }
            ],
            passthroughBehavior: ApiGateway.PassthroughBehavior.NEVER
        });

		const cvBuilderHealthMethodOptions: ApiGateway.MethodOptions = {
			methodResponses: [
				{
					statusCode: "200",
					responseModels: {
						"application/json": ApiGateway.Model.EMPTY_MODEL,
					},
					responseParameters: {
						"method.response.header.Access-Control-Allow-Origin": true,
						"method.response.header.Access-Control-Allow-Methods": true,
						"method.response.header.Access-Control-Allow-Headers": true,
					},
				},
			],
            authorizationType: ApiGateway.AuthorizationType.NONE,
		};

		cvBuilderHealth.addMethod(
			"GET",
			cvBuilderHealthMockIntegration,
			cvBuilderHealthMethodOptions,
		);

		new route53.ARecord(this, "CvBuilderApiAliasRecord", {
			zone: hostedZone,
			recordName: "cvbuilder",
			target: route53.RecordTarget.fromAlias(
				new targets.ApiGatewayDomain(cvBuilderDomainName),
			),
		});
	}
}
