const fs = require('fs');
const path = require('path');

function getEnv(key) {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        const lines = content.split('\n');
        for (const line of lines) {
            if (line.startsWith(key + '=')) {
                return line.substring(key.length + 1).replace(/"/g, '').trim();
            }
        }
    }
    return process.env[key];
}

const apiKey = getEnv('RUNNINGHUB_API_KEY');
const stableId = '1961996521397010434';
const ecoId = '1962384725164433410';

async function getAppInfo(appId) {
    console.log(`\n🔍 Fetching info for App ID: ${appId}`);
    try {
        // Try getting workflow detail via POST
        const endpoints = [
            `https://www.runninghub.ai/openapi/v2/workflow/${appId}`,
            `https://www.runninghub.ai/openapi/v2/app/detail`
        ];

        for (const url of endpoints) {
            console.log(`  Trying ${url}...`);
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ appId })
            });
            const json = await response.json();
            if (json.errorCode && json.errorCode !== '0' && json.errorCode !== 0) {
                console.error(`  ❌ Error: ${json.errorMessage} (Code: ${json.errorCode})`);
            } else {
                console.log(`  ✅ Success!`);
                return json;
            }
        }
        return null;
    } catch (error) {
        console.error(`❌ Failed for ${appId}: ${error.message}`);
        return null;
    }
}

async function run() {
    const ids = [stableId, ecoId];
    const extraId = process.argv[2] === '--extra' ? process.argv[3] : null;
    if (extraId) ids.push(extraId);

    const results = {};
    for (const id of ids) {
        results[id] = await getAppInfo(id);
    }

    fs.writeFileSync('app-comparison.json', JSON.stringify(results, null, 2));
    console.log('\n💾 Saved comparison to app-comparison.json');
}

run();
