// Test script to find the correct Kie.ai endpoint
// Run with: node test-kie-api.js

const API_KEY = 'dd327a55a0043458ccfb54ea0d037750';

async function testEndpoint(url, payload) {
    console.log(`\nTesting: ${url}`);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        console.log(`Status: ${response.status}`);
        const text = await response.text();
        console.log(`Response: ${text.substring(0, 500)}`);

        if (response.ok) {
            console.log('✅ SUCCESS!');
            return true;
        }
    } catch (error) {
        console.log(`❌ Error: ${error.message}`);
    }
    return false;
}

async function main() {
    const testImage = 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2';

    // Try different endpoints
    const endpoints = [
        {
            url: 'https://api.kie.ai/v1/chat/completions',
            payload: {
                model: 'google/nano-banana',
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'image_url', image_url: { url: testImage } },
                        { type: 'text', text: 'Add scandinavian furniture to this room' }
                    ]
                }]
            }
        },
        {
            url: 'https://api.kie.ai/v1/images/generations',
            payload: {
                model: 'google/nano-banana',
                prompt: 'Add scandinavian furniture',
                image: testImage
            }
        },
        {
            url: 'https://api.kie.ai/v1/images/edits',
            payload: {
                model: 'google/nano-banana-edit',
                prompt: 'Add scandinavian furniture',
                image: testImage
            }
        }
    ];

    for (const test of endpoints) {
        await testEndpoint(test.url, test.payload);
    }
}

main();
