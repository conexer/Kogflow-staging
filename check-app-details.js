const fs = require('fs');
const path = require('path');

function getEnv(key) {
    const envPath = path.resolve(process.cwd(), '.env.local');
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
        if (line.startsWith(key + '=')) return line.substring(key.length + 1).replace(/"/g, '').trim();
    }
}

const apiKey = getEnv('RUNNINGHUB_API_KEY');
const appId = '2034018763611316225';

console.log(`Checking details for App: ${appId}`);

fetch(`https://www.runninghub.cn/openapi/v2/app/detail?appId=${appId}`, {
    method: 'GET',
    headers: {
        'Authorization': `Bearer ${apiKey}`
    }
}).then(r => r.json()).then(r => {
    fs.writeFileSync('app-details.json', JSON.stringify(r, null, 2));
    console.log('Written to app-details.json');
    if (r.data && r.data.nodeInfoList) {
        console.log('FOUND NODE INFO LIST:');
        console.log(JSON.stringify(r.data.nodeInfoList, null, 2));
    } else {
        console.log('No nodeInfoList found in data.');
        console.log('Full Response:', JSON.stringify(r, null, 2));
    }
}).catch(e => console.error('FAILED:', e.message));
