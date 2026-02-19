
const apiKey = 'f33ddb9d5f1f48958df69577f6cdaa8d';
const appId = '1961996521397010434';

async function getDetail() {
    console.log(`Fetching detail for App: ${appId} (.ai domain)`);
    const url = `https://www.runninghub.ai/openapi/v2/app/detail`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ appId })
        });
        const data = await response.json();
        console.log('App Detail:', JSON.stringify(data, null, 2));
    } catch (e) {
        console.log('Error:', e.message);
    }
}

getDetail();
