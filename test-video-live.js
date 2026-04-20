
const API_KEY = 'f33ddb9d5f1f48958df69577f6cdaa8d';
const APP_ID = '2034018763611316225';
const BASE = 'https://www.runninghub.cn';

// 3 sample real estate images (public Unsplash)
const TEST_IMAGES = [
    'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1280&q=80',
    'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=1280&q=80',
    'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=1280&q=80'
];

const PROMPT = 'Slow, continuous forward tracking shot at eye-level. Smooth gimbal-stabilized handheld motion gliding linearly deep into the room, slightly passing the midpoint. Constant forward momentum, no cuts, realistic walking perspective.';

const WIDTH = 1280;
const HEIGHT = 720;
const ASPECT = '16:9';

async function submitImage(imageUrl, index) {
    console.log(`\n📤 Submitting image ${index + 1}/3: ${imageUrl.slice(0, 60)}...`);
    const payload = {
        nodeInfoList: [
            { nodeId: '122', fieldName: 'image',        fieldValue: imageUrl,       description: 'Source image' },
            { nodeId: '147', fieldName: 'text',         fieldValue: PROMPT,         description: 'Motion prompt' },
            { nodeId: '112', fieldName: 'width',        fieldValue: String(WIDTH),  description: 'Width' },
            { nodeId: '113', fieldName: 'height',       fieldValue: String(HEIGHT), description: 'Height' },
            { nodeId: '111', fieldName: 'aspect_ratio', fieldValue: ASPECT,         description: 'Aspect ratio' }
        ],
        instanceType: 'default',
        usePersonalQueue: 'false'
    };

    const res = await fetch(`${BASE}/openapi/v2/run/ai-app/${APP_ID}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const json = await res.json();
    console.log(`   Response:`, JSON.stringify(json));

    if (json.taskId) {
        console.log(`   ✅ Task ID: ${json.taskId}`);
        return json.taskId;
    } else {
        console.error(`   ❌ No taskId. Error: ${json.errorMessage || json.message}`);
        return null;
    }
}

async function pollStatus(taskId, maxWaitMs = 300000) {
    const start = Date.now();
    let attempt = 0;
    while (Date.now() - start < maxWaitMs) {
        attempt++;
        await new Promise(r => setTimeout(r, 15000)); // poll every 15s
        const elapsed = Math.round((Date.now() - start) / 1000);
        process.stdout.write(`   [${elapsed}s] Polling attempt ${attempt}...`);

        const res = await fetch(`${BASE}/openapi/v2/query`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId })
        });
        const json = await res.json();
        const status = json.status;
        process.stdout.write(` status=${status}\n`);

        if (status === 'SUCCESS' && json.results?.length > 0) {
            const vid = json.results.find(r => r.fieldName === 'video_url') || json.results[0];
            return { status: 'success', videoUrl: vid?.fileUrl || vid?.url };
        }
        if (status === 'FAILED') {
            return { status: 'failed', error: json.errorMessage || json.failedReason?.exception_message || 'Unknown' };
        }
    }
    return { status: 'timeout' };
}

async function getAppDetail() {
    console.log('\n🔍 Fetching workflow/app detail...');
    const res = await fetch(`${BASE}/openapi/v2/app/detail`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: APP_ID })
    });
    const json = await res.json();
    console.log('App detail:', JSON.stringify(json, null, 2));
    return json;
}

async function main() {
    console.log('='.repeat(60));
    console.log('KOGFLOW VIDEO GENERATION TEST');
    console.log('='.repeat(60));
    console.log(`App ID:  ${APP_ID}`);
    console.log(`Model:   WAN 2.2 (Image-to-Video)`);
    console.log(`Prompt:  "${PROMPT}"`);
    console.log(`Images:  ${TEST_IMAGES.length}`);
    console.log(`Output:  ${WIDTH}x${HEIGHT} (${ASPECT})`);

    // Get app details first
    await getAppDetail();

    const taskIds = [];

    // Submit image 1
    const t1 = await submitImage(TEST_IMAGES[0], 0);
    if (t1) taskIds.push({ taskId: t1, imageUrl: TEST_IMAGES[0] });

    // Wait 2s between submissions
    await new Promise(r => setTimeout(r, 2000));
    const t2 = await submitImage(TEST_IMAGES[1], 1);
    if (t2) taskIds.push({ taskId: t2, imageUrl: TEST_IMAGES[1] });

    await new Promise(r => setTimeout(r, 2000));
    const t3 = await submitImage(TEST_IMAGES[2], 2);
    if (t3) taskIds.push({ taskId: t3, imageUrl: TEST_IMAGES[2] });

    if (taskIds.length === 0) {
        console.error('\n❌ No tasks submitted successfully. Aborting.');
        process.exit(1);
    }

    console.log(`\n⏳ Submitted ${taskIds.length} tasks. Now polling for results (up to 5 min each)...`);

    // Poll all tasks
    for (const { taskId, imageUrl } of taskIds) {
        console.log(`\n🎬 Polling task ${taskId}...`);
        const result = await pollStatus(taskId);
        if (result.status === 'success') {
            console.log(`✅ VIDEO READY: ${result.videoUrl}`);
        } else {
            console.log(`❌ Task ${taskId} result: ${result.status} — ${result.error || ''}`);
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('TEST COMPLETE');
    console.log('='.repeat(60));
    console.log(`\nWorkflow link: https://www.runninghub.ai/workflow/${APP_ID}`);
    console.log(`Direct app:    https://www.runninghub.ai/app/${APP_ID}`);
}

main().catch(console.error);
