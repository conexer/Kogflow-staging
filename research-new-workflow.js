
const API_KEY = 'f33ddb9d5f1f48958df69577f6cdaa8d';
const APP_ID = '2024413696558108674';

async function research() {
    console.log(`🔍 Researching RunningHub Workflow: ${APP_ID}...`);

    const tests = [
        { name: 'App Detail (v2 POST)', url: `https://www.runninghub.cn/openapi/v2/app/detail`, method: 'POST', body: { appId: APP_ID } },
        { name: 'App Info (v2 GET)', url: `https://www.runninghub.cn/openapi/v2/app/${APP_ID}`, method: 'GET' },
        { name: 'Workflow Detail (v2 GET)', url: `https://www.runninghub.cn/openapi/v2/workflow/${APP_ID}`, method: 'GET' },
        { name: 'App List (v2 POST Search)', url: `https://www.runninghub.cn/openapi/v2/app/list`, method: 'POST', body: { pageNo: 1, pageSize: 1, keyword: APP_ID } }
    ];

    for (const test of tests) {
        console.log(`\n🧪 Testing: ${test.name}`);
        try {
            const options = {
                method: test.method,
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Type': 'application/json'
                }
            };
            if (test.body) options.body = JSON.stringify(test.body);

            const response = await fetch(test.url, options);
            console.log(`   Status: ${response.status}`);
            const data = await response.json();
            console.log(`   Response: ${JSON.stringify(data, null, 2).substring(0, 1000)}`);

            if (data.errorCode === 0 || data.errorCode === "0" || data.data) {
                console.log(`   ✅ SUCCESS!`);
            }
        } catch (e) {
            console.log(`   ❌ Error: ${e.message}`);
        }
    }
}

research();
