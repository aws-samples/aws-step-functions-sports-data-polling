import { App, CfnParameter, Duration, Stack, StackProps } from "aws-cdk-lib";
import { SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import {
  Effect,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import {
  ParameterTier,
  ParameterType,
  StringParameter,
} from "aws-cdk-lib/aws-ssm";
import {
  Choice,
  Condition,
  Pass,
  StateMachine,
  Succeed,
  Wait,
  WaitTime,
} from "aws-cdk-lib/aws-stepfunctions";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as path from "path";

export class SportsDataStack extends Stack {
  constructor(scope: App, id: string, props?: StackProps) {
    super(scope, id, props);

    const accountId = Stack.of(this).account;
    const region = Stack.of(this).region;
    const appName = "SportsDataPolling";
    const eventBridgeRuleName = "GameDayGameStartRule";

    const emailAddress = new CfnParameter(this, "emailAddress", {
      type: "String",
      description: "The email address that will get score updates.",
    });

    const teamId = new CfnParameter(this, "teamId", {
      type: "String",
      description:
        "Your favorite team id. For full list you can look at the teams file.",
      default: "sr:team:794340",
      allowedValues: [
        "sr:team:3675",
        "sr:team:3698",
        "sr:team:3677",
        "sr:team:3678",
        "sr:team:3680",
        "sr:team:3683",
        "sr:team:3679",
        "sr:team:3681",
        "sr:team:3682",
        "sr:team:3684",
        "sr:team:3685",
        "sr:team:3686",
        "sr:team:3687",
        "sr:team:3688",
        "sr:team:3689",
        "sr:team:3690",
        "sr:team:3704",
        "sr:team:3705",
        "sr:team:3703",
        "sr:team:3701",
        "sr:team:3700",
        "sr:team:3699",
        "sr:team:3697",
        "sr:team:794340",
        "sr:team:3696",
        "sr:team:3695",
        "sr:team:3694",
        "sr:team:3693",
        "sr:team:3692",
        "sr:team:344158",
        "sr:team:3691",
        "sr:team:3676",
      ],
    });

    // Set hit interval in seconds
    const hitIntervalInSeconds = 60; // This is intentionally high due to trial key limitations
    const hitDurationInSeconds = 3 * 60 * 60; // 3 hours * 60 minute * 60 seconds
    // Count will be calculated based on hitDurationInSeconds/hitIntervalInSeconds

    // Set VPC with tow subnets
    // Web Tier: First subnet will be public
    // Application Tier: Second subnet will be private
    const SportDataVPC = new Vpc(this, `${appName}-SportDataVpc`, {
      cidr: "10.0.0.0/16",
      natGateways: 1,
      maxAzs: 2,
      subnetConfiguration: [
        {
          name: "Web Tier",
          subnetType: SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "Application Tier",
          subnetType: SubnetType.PRIVATE_WITH_NAT,
          cidrMask: 24,
        },
      ],
    });

    // Add a parameter to systems manager for Api key
    const ApiKey = new StringParameter(this, `${appName}-APIKey`, {
      parameterName: "SportradarApiKey",
      description: "API key to pull data from sportradar.com",
      simpleName: true,
      type: ParameterType.STRING,
      stringValue: "update-this", // This should be updated manually on AWS Console
      tier: ParameterTier.STANDARD,
    });

    // Create an SNS topic to publish game scores
    const scoresTopic = new Topic(this, `${appName}-ScoresTopic`, {
      displayName: "Scores Topic",
    });

    // Add email subscription for the topic
    scoresTopic.addSubscription(
      new EmailSubscription(emailAddress.value.toString())
    );

    // Create an IAM role for the lambda function that will process game data
    const gameDataLambdaRole = new Role(
      this,
      `${appName}-GameDataLambdaIAMRole`,
      {
        assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
        managedPolicies: [
          {
            managedPolicyArn:
              "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
          },
          {
            managedPolicyArn:
              "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole",
          },
        ],
        inlinePolicies: {
          PublishMessage: new PolicyDocument({
            statements: [
              new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["sns:Publish"],
                resources: [scoresTopic.topicArn],
              }),
            ],
          }),
        },
      }
    );

    // The lambda function to process game data
    const gameDataLambda = new Function(this, `${appName}-GameDataLambda`, {
      description:
        "Lambda function that pulls game data for a game from sportradar.com",
      role: gameDataLambdaRole,
      runtime: Runtime.NODEJS_14_X,
      memorySize: 1024,
      timeout: Duration.minutes(1),
      code: Code.fromAsset(path.join(__dirname, "/../src")),
      handler: "game-data-lambda.handler",
      vpc: SportDataVPC,
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_NAT,
      },
      environment: {
        REGION: region,
        SCORES_TOPIC: scoresTopic.topicArn,
      },
    });

    // Creating State Machine to Iterate
    const ConfigureCount = new Pass(this, `ConfigureCount`, {
      result: {
        value: {
          index: 0,
          step: 1,
          count: Math.round(hitDurationInSeconds / hitIntervalInSeconds),
          score: 0,
        },
      },
      resultPath: "$.iterator",
    });

    const Iterator = new LambdaInvoke(this, `GameDataTask`, {
      lambdaFunction: gameDataLambda,
      payloadResponseOnly: true,
      retryOnServiceExceptions: false,
      resultPath: "$.iterator",
    });

    const waitState = new Wait(this, `Wait`, {
      time: WaitTime.duration(Duration.seconds(hitIntervalInSeconds)),
    }).next(Iterator);

    const doneState = new Succeed(this, `Done`);

    const IsCountReached = new Choice(this, "IsCountReached", {
      comment: "If the count is reached then end the process",
    })
      .when(
        Condition.stringEquals("$.iterator.continue", "CONTINUE"),
        waitState
      )
      .otherwise(doneState);

    const gameDataStateMachine = new StateMachine(
      this,
      `${appName}-SportsDataStateMachine`,
      {
        stateMachineName: `${appName}-SportsDataStateMachine`,
        definition: ConfigureCount.next(Iterator).next(IsCountReached),
      }
    );

    // Create IAM Role for execution of state machine
    const stepFunctionExecutionRole = new Role(
      this,
      `${appName}-StepFunctionExecutionRole`,
      {
        roleName: `${appName}-StepFunctionExecutionRole`,
        assumedBy: new ServicePrincipal("events.amazonaws.com"),
        inlinePolicies: {
          ExecuteStepFunction: new PolicyDocument({
            statements: [
              new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["states:StartExecution"],
                resources: [gameDataStateMachine.stateMachineArn],
              }),
            ],
          }),
        },
      }
    );

    // Create an IAM role for the lambda function
    const checkGamesLambdaRole = new Role(
      this,
      `${appName}-CheckGamesLambdaIAMRole`,
      {
        assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
        managedPolicies: [
          {
            managedPolicyArn:
              "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
          },
          {
            managedPolicyArn:
              "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole",
          },
        ],
        inlinePolicies: {
          ReadParameterStore: new PolicyDocument({
            statements: [
              new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["ssm:GetParameter", "ssm:GetParameters"],
                resources: [ApiKey.parameterArn],
              }),
            ],
          }),
          CreateEventBridgeRule: new PolicyDocument({
            statements: [
              new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["events:PutTargets", "events:PutRule"],
                resources: [
                  `arn:aws:events:${region}:${accountId}:rule/${eventBridgeRuleName}`,
                ],
              }),
            ],
          }),
          IamPassRole: new PolicyDocument({
            statements: [
              new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["iam:PassRole"],
                resources: [stepFunctionExecutionRole.roleArn],
              }),
            ],
          }),
        },
      }
    );

    // The lambda function to check games every day
    const checkGamesLambda = new Function(this, `${appName}-CheckGamesLambda`, {
      description: "Lambda function that pulls game data from sportradar.com",
      role: checkGamesLambdaRole,
      runtime: Runtime.NODEJS_14_X,
      memorySize: 1024,
      timeout: Duration.minutes(1),
      code: Code.fromAsset(path.join(__dirname, "/../src")),
      handler: "check-games-lambda.handler",
      vpc: SportDataVPC,
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_NAT,
      },
      environment: {
        REGION: region,
        EVENT_BRIDGE_RULE: eventBridgeRuleName,
        STATE_MACHINE: gameDataStateMachine.stateMachineArn,
        STATE_MACHINE_EXECUTION_ROLE: stepFunctionExecutionRole.roleArn,
        TEAM_ID: teamId.value.toString(),
      },
    });

    // Creating Event Rule
    const lambdaTarget = new LambdaFunction(checkGamesLambda, {
      retryAttempts: 2,
    });
    const checkGamesScheduleRule = new Rule(
      this,
      `${appName}-CheckGamesScheduleRule`,
      {
        ruleName: `${appName}-CheckGamesScheduleRule`,
        description: "Rule for running Lambda function once every day",
        schedule: Schedule.cron({ minute: "0", hour: "16" }), // 16 GMT -> 9am PDT
      }
    );
    checkGamesScheduleRule.addTarget(lambdaTarget);
  }
}
