import {createDemoServer} from '../demo/server.mjs';
const port=Number(process.env.FM_DEMO_PORT||4173);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('FM_DEMO_PORT must be 1024..65535');
const server=createDemoServer();server.listen(port,'127.0.0.1',()=>console.log('FM WORKS CTO説明用: http://127.0.0.1:'+port+'/#finance\nGitHubの架空データだけで動作します。終了: Ctrl+C'));
