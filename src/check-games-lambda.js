const AWS = require("aws-sdk");
const https = require("https");

const ssmClient = new AWS.SSM({ region: process.env.REGION });
const eventBridgeClient = new AWS.EventBridge({ region: process.env.REGION });
const eventBridgeRuleName = process.env.EVENT_BRIDGE_RULE;

// Api accepts year, month and day separately;
const todayDate = new Date();
const gameYear = todayDate.toLocaleDateString("en-US", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
});
const gameMonth = todayDate.toLocaleDateString("en-US", {
  timeZone: "America/Los_Angeles",
  month: "numeric",
});
const gameDay = todayDate.toLocaleDateString("en-US", {
  timeZone: "America/Los_Angeles",
  day: "numeric",
});
const gameDate = `${gameYear}-${gameMonth}-${gameDay}`;

// We are going to use sportradar api endpoint
// More info can be found here
// https://developer.sportradar.com/docs/read/hockey/NHL_v7
const gamesUrl = "api.sportradar.us";
const accessLevel = "trial"; // In production accounts, this will be production

// Schedule endpoint for NHL
// https://developer.sportradar.com/docs/read/hockey/NHL_v7#daily-schedule
// https://feed.elasticstats.com/schema/hockey/schedule-v6.0.xsd
const gamesByDateUrl = `/nhl/${accessLevel}/v7/en/games/${gameYear}/${gameMonth}/${gameDay}/schedule.json`;

// We are going to check games for our team
const teamId = process.env.TEAM_ID;

// http call options
const defaultOptions = {
  hostname: gamesUrl,
  port: 443,
  method: "GET",
  headers: {
    "Content-Type": "application/json",
  },
};

// lambda handler
exports.handler = async () => {
  // Get Api key first from Parameter Store
  const apiKeyData = await ssmClient
    .getParameter({
      Name: "SportradarApiKey",
    })
    .promise();

  const apiKey = apiKeyData.Parameter?.Value || "";

  if (!apiKey || apiKey === "" || apiKey === "update-this") {
    return "You should set the API Key in the Parameter Store";
  }

  // Append API key to the url
  const gamesByDateUrlWithKey = `${gamesByDateUrl}?api_key=${apiKey}`;
  // Let's print the url for logging
  console.log("Games By Date Url: ", gamesUrl + gamesByDateUrlWithKey);

  try {
    // Get game data
    const payload = await getDataFromUrl(gamesByDateUrlWithKey);
    const { games } = payload;

    // Filter for the game that we are looking for
    const myGame = games.find(
      (g) => g.home.sr_id === teamId || g.home.sr_id === teamId
    );

    // If there is a game then process
    if (myGame) {
      const gameId = myGame.id;
      const homeGame = myGame.home.sr_id === teamId;

      // Print the game id
      console.log(`This is my game with Game ID: ${gameId}`);
      const gameDatetime = new Date(myGame.scheduled);
      const gameMonth = gameDatetime.getMonth() + 1;
      const gameDay = gameDatetime.getDate();
      const gameHour = gameDatetime.getHours();
      const gameMinute = gameDatetime.getMinutes();

      try {
        // Create a cron rule for EventBridge
        const putRuleResponse = await eventBridgeClient
          .putRule({
            Name: eventBridgeRuleName,
            Description: "Game start time rule to execute the state machine",
            ScheduleExpression: `cron(${gameMinute} ${gameHour} ${gameDay} ${gameMonth} ? *)`,
            State: "ENABLED",
          })
          .promise();

        try {
          // Add target for the rule
          await eventBridgeClient
            .putTargets({
              Rule: eventBridgeRuleName,
              Targets: [
                {
                  Id: "SportsDataStateMachine",
                  Arn: process.env.STATE_MACHINE,
                  RoleArn: process.env.STATE_MACHINE_EXECUTION_ROLE,
                  Input: JSON.stringify({
                    gameId,
                    homeGame,
                    apiKey,
                  }),
                },
              ],
            })
            .promise();
        } catch (e) {
          console.log("Error occurred while creating the EventBridge rule!", e);
        }
      } catch (e) {
        console.log("Error occurred while creating the EventBridge rule!", e);
      }

      console.log("There is a game today! EventBridge rule has been added!");
    } else {
      console.log("No game today!");
    }
  } catch (e) {
    console.log(e);
  }
};

const JSonParse = (str) => {
  try {
    return JSON.parse(str);
  } catch (e) {
    console.log(e);
    return false;
  }
};

const getDataFromUrl = (path) =>
  new Promise((resolve, reject) => {
    const options = { ...defaultOptions, path };
    const req = https.get(options, (res) => {
      let buffer = "";
      res.on("data", (chunk) => (buffer += chunk));
      res.on("end", () => {
        const response = JSonParse(buffer);
        resolve(response || []);
      });
    });
    req.on("error", (e) => reject(e.message));
    req.on("error", (e) => {
      console.log("Error occurred! ", e.message);
    });
    req.end();
  });
