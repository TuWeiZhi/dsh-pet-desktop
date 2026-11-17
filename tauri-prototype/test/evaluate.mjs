import { connect } from './cdp.mjs';
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const client = await connect(Number(process.env.DSH_PET_TAURI_DEBUG_PORT || 9337), process.argv[2] || 'pet.localhost');
try { console.log(JSON.stringify(await client.evaluate(Buffer.concat(chunks).toString('utf8')))); }
finally { client.close(); }
