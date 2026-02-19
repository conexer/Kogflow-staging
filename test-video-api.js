const fs = require('fs');
const path = require('path');

function getEnv(key) {
    try {
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
    } catch (e) {
        console.error('Error reading .env.local', e);
    }
    return process.env[key];
}

const apiKey = getEnv('RUNNINGHUB_API_KEY');
const taskId = '2022237315807711233'; // From previous test
const appId = '1962384725164433410';
const testImageUrl = "https://vmuvjfflszhifuyvmjwh.supabase.co/storage/v1/object/public/uploads/project-assets/test-project-456/1739784343118_v009h.jpg";

if (!apiKey) {
    console.error('❌ RUNNINGHUB_API_KEY not found');
    process.exit(1);
}

console.log(`🔑 API Key: ${apiKey.substring(0, 10)}...`);
console.log(`📋 Task ID: ${taskId}`);
console.log(`🎯 App ID: ${appId}\n`);

async function testEndpoint(label, url, body, method = 'POST') {
    console.log(`\n━━━ ${label} ━━━`);
    console.log(`URL: ${method} ${url}`);
    if (body) console.log(`Body: ${JSON.stringify(body)}`);

    try {
        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            }
        };
        if (body) options.body = JSON.stringify(body);

        const res = await fetch(url, options);

        console.log(`✓ Status: ${res.status}`);
        const text = await res.text();

        try {
            const json = JSON.parse(text);
            console.log(`✓ Response:\n${JSON.stringify(json, null, 2).substring(0, 500)}`);

            // Check if successful
            if (json.status || json.taskId) {
                console.log(`\n🎉 SUCCESS! This might be the correct endpoint!`);
                return true;
            }
        } catch {
            console.log(`✓ Response: ${text.substring(0, 300)}`);
        }
    } catch (e) {
        console.error(`✗ Error: ${e.message}`);
    }
    return false;
}

async function run() {
    // Based on run endpoint: /openapi/v2/run/ai-app/{appId}
    // Status endpoint is likely: /openapi/v2/query/ai-app/{appId}

    let success = await testEndpoint(
        'Test 1: Query with App ID',
        `https://www.runninghub.cn/openapi/v2/query/ai-app/${appId}`,
        { taskId }
    );

    if (!success) {
        success = await testEndpoint(
            'Test 2: Query with taskIds array',
            `https://www.runninghub.cn/openapi/v2/query/ai-app/${appId}`,
            { taskIds: [taskId] }
        );
    }

    if (!success) {
        success = await testEndpoint(
            'Test 3: Status with App ID',
            `https://www.runninghub.cn/openapi/v2/query`,
            { taskId, appId }
        );
    }

    if (!success) {
        success = await testEndpoint(
            'Test 4: Generic query',
            `https://www.runninghub.cn/openapi/v2/query`,
            { taskId }
        );
    }

    console.log('\n🚀 Testing RUN for new App ID...');
    const runPayload = {
        nodeInfoList: [
            { nodeId: "39", fieldName: "image", fieldValue: testImageUrl },
            { nodeId: "44", fieldName: "string", fieldValue: "the camera very slowly glides into the scene" }
        ]
    };

    await testEndpoint(
        'Test 5: Run Cloud App (Migration Check)',
        `https://www.runninghub.cn/openapi/v2/run/ai-app/${appId}`,
        runPayload
    );

    console.log('\n🔍 Discovering App Interface...');
    await testEndpoint(
        'Test 6: Get App Info (GET)',
        `https://www.runninghub.cn/openapi/v2/app/${appId}`,
        null,
        'GET'
    );

    await testEndpoint(
        'Test 7: Get Workflow Detail (GET)',
        `https://www.runninghub.cn/openapi/v2/workflow/${appId}`,
        null,
        'GET'
    );

    console.log('\n🚀 Testing RUN with Node ID 4 (Standard I2V)...');
    const runPayload4 = {
        nodeInfoList: [
            { nodeId: "4", fieldName: "image", fieldValue: testImageUrl },
            { nodeId: "4", fieldName: "prompt", fieldValue: "the camera very slowly glides into the scene" }
        ]
    };
    await testEndpoint('Test 8: Run with Node 4', `https://www.runninghub.cn/openapi/v2/run/ai-app/${appId}`, runPayload4);

    console.log('\n🚀 Testing RUN with Node ID 1 (Image) / 2 (Prompt)...');
    const runPayload12 = {
        nodeInfoList: [
            { nodeId: "1", fieldName: "image", fieldValue: testImageUrl },
            { nodeId: "2", fieldName: "prompt", fieldValue: "the camera very slowly glides into the scene" }
        ]
    };
    await testEndpoint('Test 9: Run with Node 1/2', `https://www.runninghub.cn/openapi/v2/run/ai-app/${appId}`, runPayload12);

    console.log('\n🚀 Testing MINIMAL RUN (Node 39 only)...');
    await testEndpoint('Test 10: Minimal Node 39', `https://www.runninghub.cn/openapi/v2/run/ai-app/${appId}`, {
        nodeInfoList: [{ nodeId: "39", fieldName: "image", fieldValue: testImageUrl }]
    });

    console.log('\n🚀 Testing Community Mapping (Node 12/13)...');
    await testEndpoint('Test 11: Node 12/13', `https://www.runninghub.cn/openapi/v2/run/ai-app/${appId}`, {
        nodeInfoList: [
            { nodeId: "12", fieldName: "image", fieldValue: testImageUrl },
            { nodeId: "13", fieldName: "string", fieldValue: "the camera very slowly glides into the scene" }
        ]
    });

    if (!success) {
        console.log('\n❌ None of the endpoints worked. Need to check RunningHub dashboard or docs.');
    }
}

run();
