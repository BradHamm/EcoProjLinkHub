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

// Hash urls into shorter IDs
function generateShortId() {
  return crypto.randomBytes(3).toString("hex"); // e.g., 'a3f9b2'
}


// MANAGING SESSION INFO


// post request for creation of new signup to DB

app.post("/signup", async (req, res) => {
  const { email, password, username } = req.body;
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) return res.json({ error: error.message });

  await supabase.from("profiles").insert({ id: data.user.id, username });

  req.session.user = { id: data.user.id, username };
  res.json({ success: true });
});

// post request for logging in session

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return res.json({ error: error.message });

// load profile for user
  const { data: profile } = await supabase.from("profiles").select("username").eq("id", data.user.id).single();

  req.session.user = { id: data.user.id, username: profile.username };
  res.json({ success: true });
});

// middleware: if not current user, redirect to login
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login.html");
  next();
}


// CREATING NEW LINKS



app.post("/add-link", requireAuth, async (req, res) => {
  const { title, url } = req.body;
  await supabase.from("links").insert({ user_id: req.session.user.id, title, url });
  res.redirect("/dashboard.html");
});

// Serve dashboard protected
app.get("/dashboard", requireAuth, (_, res) => {
  res.sendFile(path.join(__dirname, "public/dashboard.html"));
});


// VIEW PROFILE FROM ANON !user session


app.get("/user/:username", async (req, res) => {
  const username = req.params.username;

  const { data: profile } = await supabase.from("profiles").select("id").eq("username", username).single();
  if (!profile) return res.status(404).send("User not found");

  const { data: links } = await supabase.from("links").select("title, url, order_index").eq("user_id", profile.id).order("order_index");

  res.send(`
    <h1>${username}</h1>
    ${links.map(l => `<p><a href="${l.url}" target="_blank">${l.title}</a></p>`).join("")}
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

app.get("/s/:shortId", (req, res) => {
  const longUrl = urlDatabase[req.params.shortId];

  if (longUrl) {
    res.redirect(longUrl);
  } else {
    res.status(404).send("Short URL not found.");
  }
});


app.listen(PORT, () => console.log(`Running at http://localhost:${PORT}`));


