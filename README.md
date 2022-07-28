# Sports Data Polling

This project contains source code and supporting files for the serverless application which polls game data for your favorite NHL team and get notified when your team scores.

This application has been initally developed for the Lightning project of <a href="https://www.pacificsciencecenter.org" target="_blank">Pacific Science Center</a> to honor the Seattle Kraken team using SportRadar.com API endpoints.

More information about this project can be found here.
<a href="https://www.aboutamazon.com/news/aws/hockeys-newest-superfan-lights-up-seattle" target="_blank">https://www.aboutamazon.com/news/aws/hockeys-newest-superfan-lights-up-seattle</a>

You can change the team alias for your favorite NHL team according to documentation.
<a href="https://developer.sportradar.com/docs/read/hockey/NHL_v7#nhl-api-overview" target="_blank">https://developer.sportradar.com/docs/read/hockey/NHL_v7#nhl-api-overview</a>

The project has been developed as an <a href="https://aws.amazon.com/cdk/" target="_blank">AWS CDK</a> application using Typescript.

Note: This repository is slightly different than the initial project so that the application can be used for individual interests while keeping the core functionalities and features the same.

## Prerequisites

- You will need an AWS Account and IAM User created as well as configured in your development environment for CDK Development

  - More details how to create an AWS Account can be found <a href="https://aws.amazon.com/premiumsupport/knowledge-center/create-and-activate-aws-account/" target="_blank">here</a>.
  - More details how to create an IAM User <a href="https://docs.aws.amazon.com/IAM/latest/UserGuide/id_users_create.html" target="_blank">here</a>.
  - More details how to get started with AWS CDK v2 <a href="https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html" target="_blank">here</a>.

- You will need to create a developer account for sportradar.com <a href="https://developer.sportradar.com/member/register" target="_blank">here</a>.

  - Once registered, you will need to create an application.
  - Make sure that `Issue a new key for NHL Trial` option has been selected while creating your application.
  - You will be given a trial API key once you have created your application.

  There are two endpoints that the application is using.

  - <a href="https://developer.sportradar.com/docs/read/hockey/NHL_v7#daily-schedule">Daily Schedule endpoint</a>
  - <a href="https://developer.sportradar.com/docs/read/hockey/NHL_v7#game-boxscore">Game Boxscore endpoint</a>

## Getting Started

```js
git clone https://github.com/aws-samples/aws-step-functions-sports-data-polling
```

```js
cd aws-step-functions-sports-data-polling
npm install
```

```js
cdk bootstrap
```

```js
cdk deploy --parameters teamId="sr:team:794340" --parameters emailAddress="your email address"
```

The parameter teamId is the id for your favorite NHL team used by sportradar.com. The default id is for Seattle Kraken but if you wanna change it for your favorite team, have a look at <a href="teams.json">teams.json</a> file for your team's id.

Once the application is deployed, it will automatically subscribe the email address that you provide as a parameter to the Scores topic.

Therefore, you will get a confirmation email similar to the following and you should confirm your subscription by clicking the "Confirm subscription" link to get scores in your email.

![confirmation](/assets/sns-confirmation.png)

Note: This email address doesn't have to be the same email address you used for sportradar.com registration.

The last step is updating the API key called SportradarApiKey in AWS Systems Manager Parameter Store using your trial key from sportradar.com.

More info how to update a parameter can be found <a href="https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html" target="_blank">here</a>

## Application Lifycycle

![lifecycle](/assets/lifecycle.png)

- The application will deploy the following main resources.
  - An EventBridge Rule to trigger `check-games-lambda` function
  - A Lambda function with the file `check-games-lambda`
  - A Lambda function with the file `game-data-lambda`
  - A Step Functions State Machine
  - An SNS Topic with email subscription
- The EventBridge rule will invoke `check-games-lambda` function once a day at 8 AM PT. The lambda function will check the games scheduled for the day of invokation.
- If there is an NHL game for Seattle Kraken then the lambda function will create another EventBridge rule that will start an execution of the State Machine.
- The State Machine invokes the `game-data-lambda` function every minute. (This is intentionally high due to trial key limitations.)
- The `game-data-lambda` function checks the game data for scores.
- If there is a new score, the lambda function publishes this new score to the SNS topic.
- SNS topic notifies the subscribed email address automatically as below.

  ![lifecycle](/assets/scores-topic.jpg)

- When the game is over, the State Machine will stop the execution.
