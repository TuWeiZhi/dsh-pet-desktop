const input=require('node:readline').createInterface({input:process.stdin});
input.on('line',line=>{const value=JSON.parse(line);if(value.action==='download')process.stdout.write('{"progress":25}\n');if(value.action==='cancel'){process.stdout.write('{"error":"cancelled fixture","cancelled":true}\n');input.close();process.stdin.destroy();}});
