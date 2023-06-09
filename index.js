import SDK from '@wazo/sdk/dist/wazo-sdk';
import ws from 'ws';
import fs from 'fs';
import https from 'https';

const agent = new https.Agent({
  rejectUnauthorized: false
});

global.window = global;
global.WebSocket = ws;

const { Wazo, IssueReporter } = SDK;

const server = process.env.SERVER;
const login = process.env.LOGIN;
const password = process.env.PASSWORD;
const sessionDuration = typeof process.env.SESSION_DURATION !== 'undefined' ? process.env.SESSION_DURATION : 10;
const debug = +process.env.DEBUG === 1;
const disableChatd = +process.env.DISABLE_CHATD === 1;
const tokenExpiration = +process.env.TOKEN_EXPIRATION || 300;
const disableHeaderCheck = +process.env.DISABLE_HEADER_CHECK === 1;
const logRequests = +process.env.LOG_REQUESTS === 1;
const requestTimeout = +process.env.REQUEST_TIMEOUT || 300 * 1000;
const t = new Date();
const loadId = Math.ceil(Math.random() * 10000);
let logger = console;
if (+process.env.DOCKER === 1) {
  const output = fs.createWriteStream('/debug.log');
  logger = new console.Console({ stdout: output, stderr: output });
}

Wazo.Auth.init('wda-load-test', tokenExpiration);
Wazo.Auth.setHost(server);
Wazo.Auth.setRequestTimeout(requestTimeout);

const fetchOptions = {
  headers: {
    'X-Load-Id': loadId,
  }
};

global.wazoFetchOptions[null] = fetchOptions;
Wazo.api.client.setFetchOptions({ ...Wazo.api.client.fetchOptions, fetchOptions });

if (logRequests) {
  IssueReporter.enabled = true;

  IssueReporter.log = (level, ...args) => {
    if (args[0] === 'logger-category=http') {
      const url = args[1];
      const options = args[2];
      logger.log(`[${options.method.toUpperCase()}] ${url} ${JSON.stringify(options.headers)} - ${options.status}`);
    }
  };
}

logger.log(`Started with id ${loadId}`)

if (disableHeaderCheck) {
  Wazo.Auth.shouldCheckUserUuidHeader = false;
}

Wazo.api.client.agent = agent;

const log = (message) => {
  if (!debug) {
    return;
  }

  logger.log(`[+${new Date() - t}]`, message);
}

log('Started');

(async () => {
  try {
    const session = await Wazo.Auth.logIn(login, password);
    log('Session created', new Date() - t);

    // Fetch external app
    await Wazo.getApiClient().confd.getExternalApp(session.uuid, 'wazo-euc-application-desktop');
    log('External app configuration fetched', new Date() - t);


    // Fetch app access
    await Wazo.Features.fetchAccess();
    log('App access fetched', new Date() - t);

    // Fetch sources in parallel
    const sources = await Promise.all([
      Wazo.getApiClient().dird.fetchWazoSource(session.primaryContext()),
      Wazo.getApiClient().dird.fetchGoogleSource(session.primaryContext()),
      Wazo.getApiClient().dird.fetchOffice365Source(session.primaryContext()),
    ]);
    log('Dird sources fetched', new Date() - t);

    // Fetch user info
    if (!disableChatd) {
      await Wazo.getApiClient().chatd.getContactStatusInfo(session.uuid);
      log('User info fetched', new Date() - t);
    }

    // Fetch all rooms
    const roomSource = await Wazo.getApiClient().dird.fetchConferenceSource(session.primaryContext());
    await Wazo.getApiClient().dird.fetchConferenceContacts(roomSource.items[0]);
    log('Rooms fetched', new Date() - t);

    // Fetch recent contact with statuses
    const promises = [
      Wazo.getApiClient().dird.listFavorites(session.primaryContext()),
      Wazo.getApiClient().callLogd.listCallLogs(0, 100),
      Wazo.getApiClient().calld.listVoicemails().catch(() => ([])),
    ];

    if (!disableChatd) {
      promises.push(Wazo.getApiClient().chatd.getUserRooms());
      promises.push( Wazo.getApiClient().chatd.getMessages({ distinct: 'room_uuid', order: 'created_at', limit: 30, direction: 'desc' }));
    }

    let favorites = [];
    let callLogs = [];
    let rooms = [];
    let voicemails = [];
    let messages = [];

    if (disableChatd) {
      [favorites, callLogs, voicemails] = await Promise.all(promises);
    } else {
      [favorites, callLogs, voicemails, rooms, messages] = await Promise.all(promises);
    }

    log('Activities fetched', new Date() - t);

    const contactUuids = rooms.map(room => {
      const other = room.users.find(user => user !== session.uuid)
      return other.uuid;
    })
    .concat(
      callLogs.map(callLog => callLog.theOtherParty(session).uuid),
    ).concat(
      favorites.map(favorite => favorite.uuid),
    ).filter(uuid => !!uuid);

    // Request own contact status
    contactUuids.push(session.uuid);

    // Fetch recent contacts
    await Wazo.getApiClient().dird.fetchWazoContacts(sources[0].items[0], { uuid: [...new Set(contactUuids)].join(',') });

    log('Contacts fetched', new Date() - t);

    // Fetch statuses
    if (!disableChatd) {
      await Wazo.getApiClient().chatd.getMultipleLineState(contactUuids);
      log('Contacts statuses fetched', new Date() - t);
    }

    // Switchboards
    const switchboardUuids = session.profile.switchboards.map(switchboard => switchboard.uuid);

    // Load switchboards
    for (let i = 0 ; i < switchboardUuids.length; i++) {
      const switchboardUuid = switchboardUuids[i];
      await Wazo.getApiClient().calld.fetchSwitchboardHeldCalls(switchboardUuid)
      await Wazo.getApiClient().calld.fetchSwitchboardQueuedCalls(switchboardUuid)
    }
    log('Switchboard fetched');

    // Register
    const sipLine = session.profile.sipLines[0];
    await Wazo.Phone.connect({ userAgentString: 'wda-load-test'}, sipLine);

    log('Registered');

    log(`Waiting ${sessionDuration}s ...`);

    Wazo.Websocket.ws.socket.onmessage = event => {
      const message = JSON.parse(typeof event.data === 'string' ? event.data : '{}');

      log(`WS message: ${JSON.stringify(message)}`);
    };

    // Wait some time
    await new Promise(resolve => setTimeout(resolve, sessionDuration * 1000));

    // Logout
    await Wazo.Phone.disconnect();
    log('Un-registered');

    await Wazo.Auth.logout(true);
    log('Logged out');
    process.exit(0);
  } catch (e) {
    logger.error('error', e);
    process.exit(1);
  }
})();
