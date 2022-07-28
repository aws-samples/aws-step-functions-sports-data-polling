const AWS = require('aws-sdk');
const http = require('http');
const https = require('https');

const snsClient = new AWS.SNS({ region: process.env.REGION });
const scoresTopic = process.env.SCORES_TOPIC;

const gamesUrl = 'api.sportradar.us';
const accessLevel = 'trial';

// lambda handler
exports.handler = async (event, context, callback) => {
  const gameId = event.gameId;
  const homeGame = event.homeGame;
  const apiKey = event.apiKey;

  let index = event.iterator.index;
  let step = event.iterator.step;
  let count = event.iterator.count;
  let score = event.iterator.score;

  let gameStatus = 'SCHEDULED';

  index += step;

  // Set play by play data url
  const playByPlayUrl = `/nhl/${accessLevel}/v7/en/games/${gameId}/boxscore.json?api_key=${apiKey}&cb=${index}`;
  console.log('playByPlayUrl: ', gamesUrl + playByPlayUrl);

  try {
    // Get games data
    const myGame = await getDataFromUrl(playByPlayUrl);

    // If there is a SEA game then process
    if (myGame) {
      // Check the score
      let upcomingScore = homeGame ? myGame.home?.points || 0 : myGame.away?.points || 0;
      gameStatus = myGame.status?.toUpperCase() || 'SCHEDULED';

      console.log(`[Period] Clock: [${myGame.period}] ${myGame.clock}`);
      const isGoal = parseInt(upcomingScore) > parseInt(score);

      if (isGoal) {
        // This is a goal. Publish to SNS
        const message = `Goal occurred! ${
          myGame.away.name + ': ' + myGame.away.points + ' - ' + myGame.home.name + ': ' + myGame.home.points
        }`;

        await snsClient.publish(
          {
            TopicArn: scoresTopic,
            Message: message
          },
          function (err, data) {
            if (err) {
              // if there is an error then keep the score
              upcomingScore = score;
              console.log('Error occurred while publishing the message!' + err.stack);
            } else {
              console.log(message);
            }
          }
        );
      } else {
        console.log(`No goal! Score is ${myGame.away.points + ' - ' + myGame.home.points}`);
      }

      // Set the score by the upcoming score
      score = upcomingScore;
    }
  } catch (e) {
    console.log('Error occurred while getting the game data! ' + e);
  }

  callback(null, {
    index,
    step,
    count,
    score,
    continue: index > count || ['COMPLETE'].includes(gameStatus) ? 'END' : 'CONTINUE'
  });
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
    const options = {
      hostname: gamesUrl,
      path: path,
      port: 443,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = https.get(options, (res) => {
      let buffer = '';
      res.on('data', (chunk) => (buffer += chunk));
      res.on('end', () => {
        const response = JSonParse(buffer);
        resolve(response || []);
      });
    });
    // req.on("error", (e) => reject(e.message));
    req.end();
  });
