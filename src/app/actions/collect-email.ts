'use server';

import fs from 'fs';
import path from 'path';

const CSV_FILE_NAME = 'email_1_click_product_video.csv';

export async function submitEmail(formData: FormData) {
    const email = formData.get('email') as string;

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        return { success: false, message: 'Invalid email address' };
    }

    try {
        const filePath = path.join(process.cwd(), CSV_FILE_NAME);
        const date = new Date().toISOString();
        const csvLine = `"${email}","${date}"\n`;

        // specific check for file existence to add header if needed
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, 'Email,Date\n');
        }

        fs.appendFileSync(filePath, csvLine);

        return { success: true, message: 'Email subscribed successfully!' };
    } catch (error) {
        console.error('Error saving email:', error);
        return { success: false, message: 'Failed to save email. Please try again.' };
    }
}
