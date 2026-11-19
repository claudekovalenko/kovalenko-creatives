// Client portal settings. Fill these in from the Supabase project (Project Settings → API).
// The publishable (anon) key is meant to be public: Row Level Security in supabase/portal.sql decides
// what each signed-in person can see. Never put the service-role key here.
window.PORTAL_CONFIG = {
  supabaseUrl: '',
  publishableKey: '',
};
