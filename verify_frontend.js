require('dotenv').config({ path: './frontend/.env' });
const { createClient } = require('@supabase/supabase-js');

async function verifyFrontend() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.error("❌ Failed: Keys not found in frontend/.env");
    process.exit(1);
  }

  const supabase = createClient(url, key);

  console.log("Testing Supabase connection with Anon key...");
  
  const { data, error } = await supabase
    .from('recovery_cases')
    .select('id, status')
    .limit(5);

  if (error) {
    console.error("❌ Failed: Could not fetch data. Error:", error.message);
    process.exit(1);
  }

  console.log(`✅ Success! Successfully connected and fetched ${data.length} cases.`);
  if (data.length > 0) {
    console.log("Sample cases:", data);
  } else {
    console.log("The table is empty, but the connection works perfectly!");
  }
}

verifyFrontend();
