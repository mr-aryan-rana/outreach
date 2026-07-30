// Deliberately does NOT auto-load any .env file. Integration tests only run
// against DATABASE_URL/REDIS_URL that the person running them has explicitly
// exported into the shell environment for this project -- silently reading
// an .env file here previously caused this suite to connect to an unrelated
// project's live Supabase/Upstash instance and attempt a real write against
// it. Never reintroduce implicit file loading here.
