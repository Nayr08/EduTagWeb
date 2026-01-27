// ⚠️ TEMPLATE - Replace with your own Supabase credentials
// DO NOT commit actual credentials to GitHub!

const SUPABASE_URL = "YOUR_SUPABASE_URL_HERE";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY_HERE";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

// Rest of your code...
