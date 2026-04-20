const fs = require('fs');
const path = require('path');

function getEnv(key) {
    const content = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8');
    for (const line of content.split('\n')) {
        if (line.startsWith(key + '=')) return line.substring(key.length + 1).replace(/"/g, '').trim();
    }
}

const apiKey = getEnv('RUNNINGHUB_API_KEY');
const WAN22_APP_ID = '1959889002553880577';

console.log('API Key (partial):', apiKey ? apiKey.substring(0, 8) + '...' : 'NOT FOUND');
console.log('Testing App ID:', WAN22_APP_ID);

// get app detail
fetch('https://www.runninghub.cn/openapi/v2/app/detail', {
    method: 'POST',
    headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({ appId: WAN22_APP_ID })
}).then(r => r.json()).then(r => {
    console.log('\nApp Detail Response:');
    console.log(JSON.stringify(r, null, 2));
}).catch(e => console.error('Error:', e.message));
