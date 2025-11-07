import express from "express";
import session from "express-session";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

//testing:
console.log("Supabase URL:", process.env.SUPABASE_URL);
console.log("Supabase Key:", process.env.SUPABASE_KEY?.slice(0, 10) + "...");



const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;


// middleware setup

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
}));



// initializes DB
const urlDatabase = {};

// hash function for unique link IDs / suffixes
function generateShortId() {
  return crypto.randomBytes(3).toString("hex"); // hexidecimal hash
}


// MANAGING SESSION INFO


app.get("/", (req, res) => {
  if (req.session.user) {
    res.redirect("/dashboard");
  } else {
    res.redirect("/login.html");
  }
});


// post request for creation of new signup to DB

app.post("/signup", async (req, res) => {
  const { email, password, username } = req.body;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: "http://localhost:3000/login.html" }
  });

  if (error) return res.send("Sign up failed: " + error.message);

  if (data.user) {
  await supabase.from("profiles").insert([
    { id: data.user.id, username }
  ]);
}

// change this to HTML instead of JSON at some point

  res.send(`
    <h2>Verify Your Email</h2>
    <p>A confirmation link has been sent to <strong>${email}</strong>.</p>
    <p>Please verify your email, then <a href="/login.html">log in here</a>.</p>
  `);
});


// post request for logging in session

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return res.send("Invalid email or password.");
  }

  // Ensure profile exists
  const { data: profile, error: profileError } = await supabase
  .from("profiles")
  .select("username")
  .eq("id", data.user.id)
  .maybeSingle();

  console.log("Profile lookup result:", profile, "Error:", profileError);

  if (profileError || !profile) {
    console.log("Profile not found for user:", data.user.id);
    return res.send("Profile not found. Please sign up again.");
  }


  req.session.user = { id: data.user.id, username: profile.username };
  res.redirect("/dashboard");
});





app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login.html");
  });
});

// middleware: if not current user, redirect to login

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login.html");
  next();
}

app.get("/dashboard", requireAuth, async (req, res) => {
  const { data: links, error } = await supabase
    .from("links")
    .select("title, short_id")
    .eq("user_id", req.session.user.id)
    .order("created_at", { ascending: false });

  if (error) console.error("Error loading links:", error);

  const linksHTML = (links || [])
    .map(l => `<p><a href="/s/${l.short_id}" target="_blank">${l.title}</a></p>`)
    .join("") || "<p>No links yet.</p>";

  res.send(`
    <h1>Welcome, ${req.session.user.username}</h1>
    <p>Your user ID is: ${req.session.user.id}</p>
    <a href="/logout">Logout</a>
    <hr>
    <h3>Add a New Link</h3>
    <form method="POST" action="/add-link">
      <input name="title" placeholder="Link title" required>
      <input name="url" type="url" placeholder="https://example.com" required>
      <button type="submit">Add Link</button>
    </form>
    <hr>
    <h3>Your Links</h3>
    ${linksHTML}
  `);
});






// CREATING NEW LINKS


// Add a new link for the logged-in user
app.post("/add-link", requireAuth, async (req, res) => {
  const { title, url } = req.body;
  const { id: user_id } = req.session.user;

  // creates short ID
  const short_id = generateShortId();
  const short_url = `${req.protocol}://${req.get("host")}/s/${short_id}`;

  // insert both the original and shortened URL in SupaBase
  const { error } = await supabase.from("links").insert([
    { user_id, title, url, short_id }
  ]);

  if (error) {
    console.error("Error adding link:", error);
    return res.send("Error adding link: " + error.message);
  }

  res.redirect("/dashboard");
});



// VIEW PROFILE FROM ANON !user session


app.get("/user/:username", async (req, res) => {
  const username = req.params.username;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .single();

  if (!profile) return res.status(404).send("User not found.");

  const { data: links } = await supabase
    .from("links")
    .select("title, short_id")
    .eq("user_id", profile.id)
    .order("order_index");


// test: is this shit working for the user or for the visitors? vvv

  const linksHTML = (links || [])
    .map(l => `<p><a href="/s/${l.short_id}" target="_blank">${l.title}</a></p>`)
    .join("") || "<p>Links currently missing (This user is missing links).</p>";

  res.send(`
    <h1>${username}'s Links</h1>
    ${linksHTML}
  `);
});





// SHORTENING REQUESTS


// post requests for shortening links
app.post("/shorten", (req, res) => {
  const { longUrl } = req.body;

  if (!longUrl || !longUrl.startsWith("http")) {
    return res.status(400).json({ error: "Invalid URL" });
  }

  const shortId = generateShortId();
  urlDatabase[shortId] = longUrl;

  const shortUrl = `${req.protocol}://${req.get("host")}/${shortId}`;
  res.json({ shortUrl });
});

// redirect to link from shortened URL

app.get("/s/:shortId", async (req, res) => {
  const { shortId } = req.params;

  const { data, error } = await supabase
    .from("links")
    .select("url")
    .eq("short_id", shortId)
    .single();

  if (error || !data) return res.status(404).send("Short URL not found.");

  // basic record of analytics UPDATE LATER to include security against webscrapers
  await supabase.from("clicks").insert([
    {
      short_id: shortId,
      clicked_at: new Date(),
      referrer: req.get("referer") || "direct",
      user_agent: req.get("user-agent")
    }
  ]);

  res.redirect(data.url);
});



app.listen(PORT, () => console.log(`Running at http://localhost:${PORT}`));


