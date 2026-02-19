

const API_KEY = 'bfc77eecc62746ed80d3d64771a38b5e'; // From Enterprise-Shared screenshot
const WORKFLOW_ID = '2014821760687939586';

const ENDPOINTS = [
    'https://www.runninghub.ai/api/v1/workflow/run',
    'https://www.runninghub.cn/api/v1/workflow/run'
];

const HEADERS_TO_TEST = [
    { name: 'Bearer', headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' } },
    { name: 'No Bearer', headers: { 'Authorization': API_KEY, 'Content-Type': 'application/json' } },
    { name: 'apikey', headers: { 'apikey': API_KEY, 'Content-Type': 'application/json' } },
    { name: 'x-api-key', headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' } },
    { name: 'Token', headers: { 'Authorization': `Token ${API_KEY}`, 'Content-Type': 'application/json' } },
    { name: 'RH-Key', headers: { 'RunningHub-Api-Key': API_KEY, 'Content-Type': 'application/json' } }
];

async function test() {
    console.log(`🧪 Testing API Key: ${API_KEY.substring(0, 6)}...`);

    // Try simple GET endpoints to verify key validity independent of workflow
    const GET_ENDPOINTS = [
        'https://www.runninghub.ai/api/v1/user/info',
    ];

    for (const endpoint of GET_ENDPOINTS) {
        console.log(`\n🌐 Testing GET: ${endpoint}`);

        for (const config of HEADERS_TO_TEST) {
            console.log(`  👉 Testing Auth Style: ${config.name}`);
            try {
                const response = await fetch(endpoint, {
                    method: 'POST', // Some APIs use POST even for info
                    headers: config.headers,
                    body: JSON.stringify({})
                });

                const text = await response.text();
                if (text.includes('TOKEN_INVALID')) {
                    console.log(`     ❌ Status: ${response.status} - INVALID`);
                } else {
                    console.log(`     ✅ Status: ${response.status} - RESPONSE: ${text.substring(0, 100)}`);
                    return;
                }
            } catch (error) {
                console.log(`     ❌ Error: ${error.message}`);
            }
        }
    }
}

test();
