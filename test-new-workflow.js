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
const appId = getEnv('RUNNINGHUB_APP_ID');
const testImageUrl = 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?q=80&w=2000&auto=format&fit=crop';

const prompt = 'Slow, continuous forward tracking shot at eye-level. Smooth gimbal-stabilized handheld motion.';

// EXPLICIT OPENAPI MAPPINGS FROM MODAL
const payload = {
    nodeInfoList: [
        { nodeId: '122', fieldName: 'image', fieldValue: testImageUrl, description: 'Source image' },
        { nodeId: '147', fieldName: 'text', fieldValue: prompt, description: 'Creative description' },
        { nodeId: '112', fieldName: 'width', fieldValue: '1280', description: 'Output width' },
        { nodeId: '113', fieldName: 'height', fieldValue: '720', description: 'Output height' },
        { nodeId: '111', fieldName: 'aspect_ratio', fieldValue: '16:9', description: 'Aspect ratio' }
    ],
    instanceType: 'default',
    usePersonalQueue: 'false'
};

console.log(`🔑 Testing App ID: ${appId}`);

fetch(`https://www.runninghub.cn/openapi/v2/run/ai-app/${appId}`, {
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
}).then(r => r.json()).then(r => {
    fs.writeFileSync('api-result.json', JSON.stringify(r, null, 2));
    if (r.taskId) {
        console.log(`✅ SUCCESS! Task ID: ${r.taskId}`);
        // Create status checker
        fs.writeFileSync('check-workflow-status.js', `
const apiKey = '${apiKey}';
const taskId = '${r.taskId}';
async function check() {
    const response = await fetch('https://www.runninghub.cn/openapi/v2/query', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId })
    });
    const json = await response.json();
    require('fs').writeFileSync('status-result.json', JSON.stringify(json, null, 2));
    console.log('Status: ' + json.status);
    if (json.results && json.results.length > 0) {
       console.log('VIDEO URL:', json.results[0].fileUrl || json.results[0].url);
    }
}
check();
        `.trim());
    } else {
        console.log(`❌ ERROR: ${r.errorCode || 'unknown'} - ${r.errorMessage || 'unknown error'}`);
    }
}).catch(e => console.error('FAILED:', e.message));
