import SDK from '@wazo/sdk/dist/wazo-sdk';
import ws from 'ws';
import https from 'https';

const agent = new https.Agent({
  rejectUnauthorized: false
});

global.window = global;
global.WebSocket = ws;

const { Wazo } = SDK;

const server = process.env.SERVER;
const login = process.env.LOGIN;
const password = process.env.PASSWORD;
const sessionDuration = typeof process.env.SESSION_DURATION !== 'undefined' ? process.env.SESSION_DURATION : 10;
const debug = +process.env.DEBUG === 1;
const t = new Date();

Wazo.Auth.init('wda-load-test', 60);
Wazo.Auth.setHost(server);

Wazo.api.client.agent = agent;

const log = (message) => {
  if (!debug) {
    return;
  }

  console.log(`[+${new Date() - t}]`, message);
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
    await Wazo.getApiClient().chatd.getContactStatusInfo(session.uuid);
    log('User info fetched', new Date() - t);

    // Fetch all rooms
    const roomSource = await Wazo.getApiClient().dird.fetchConferenceSource(session.primaryContext());
    await Wazo.getApiClient().dird.fetchConferenceContacts(roomSource.items[0]);
    log('Rooms fetched', new Date() - t);

    // Fetch recent contact with statuses
    const [favorites, callLogs, voicemails, rooms, messages] = await Promise.all([
      Wazo.getApiClient().dird.listFavorites(session.primaryContext()),
      Wazo.getApiClient().callLogd.listCallLogs(0, 100),
      Wazo.getApiClient().calld.listVoicemails().catch(() => ([])),
      Wazo.getApiClient().chatd.getUserRooms(),
      Wazo.getApiClient().chatd.getMessages({ distinct: 'room_uuid', order: 'created_at', limit: 30, direction: 'desc' }),
    ]);

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

    // Fetch recent contacts
    await Wazo.getApiClient().dird.fetchWazoContacts(sources[0].items[0], { uuid: [...new Set(contactUuids)].join(',') });

    log('Contacts fetched', new Date() - t);

    // Fetch statuses
    await Wazo.getApiClient().chatd.getMultipleLineState(contactUuids);
    log('Contacts statuses fetched', new Date() - t);

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

    Wazo.Websocket.ws.socket.onmessage = msg => {
      log(`WS message: ${JSON.stringify(msg)}`);
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
    console.error('error', e);
    process.exit(1);
  }
})();
