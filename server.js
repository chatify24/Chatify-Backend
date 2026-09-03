import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import session from "express-session";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import cloudinary from "cloudinary";
import multer from "multer";
import { createClient } from '@supabase/supabase-js';
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import path from "path";
import { initializeApp, cert } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { fileURLToPath } from "url";
import SibApiV3Sdk from 'sib-api-v3-sdk';
import crypto from "crypto";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// Helper function to convert conversation_id string to UUID
function stringToUUID(str) {
  // Create a hash of the string
  const hash = crypto.createHash('sha256').update(str).digest('hex');
  // Convert first 32 chars of hash to UUID format
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    hash.substring(12, 16),
    hash.substring(16, 20),
    hash.substring(20, 32)
  ].join('-');
}

dotenv.config({
  path: path.join(__dirname, ".env"),
});

const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8')
);
const firebaseApp = initializeApp({
  credential: cert(serviceAccount),
});

const sendPushNotification = async (fcmToken, title, body, targetId, isGroup = false) => {
  if (!fcmToken) return;
  try {
    await getMessaging(firebaseApp).send({
      token: fcmToken,
      notification: {
        title: title,
        body: body,
      },
      data: {
        contactId: targetId || "",
        isGroup: String(isGroup),
      },
      android: {
        priority: "high",
        notification: {
          channelId: "messages",
        },
      },
    });
    console.log("✅ Push sent to:", fcmToken);
  } catch (err) {
    console.error("❌ Push failed:", err.message);
  }
};
cloudinary.v2.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
  secure: true, // 🔥 YEH ADD KARO
});

// 🔥 Verify config
console.log("Cloudinary configured:", cloudinary.v2.config());
const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;

const sendEmail = async (to, subject, html) => {
  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
  await apiInstance.sendTransacEmail({
    sender: { name: "Chatify", email: process.env.BREVO_SENDER_EMAIL },
    to: [{ email: to }],
    subject: subject,
    htmlContent: html,
  });
};

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const app = express();
const storage = multer.memoryStorage();
const upload = multer({ storage });
app.use(cors());
app.use(express.json());
app.use(session({
  secret: "chatifysecret",
  resave: false,
  saveUninitialized: true,
}));

app.use(passport.initialize());
app.use(passport.session());

const otpStore = {}; 
// Format:
// otpStore[email] = {
//   otp: "123456",
//   expiresAt: timestamp
// }
const generateOtpTemplate = (otp) => {
return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Chatify OTP</title>
</head>

<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:40px 10px;">
<tr>
<td align="center">

<table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;">

<tr>
<td style="text-align:center;padding-bottom:20px;">

<img
src="https://res.cloudinary.com/dpaiyfwdu/image/upload/v1776595107/chatify_gzok1x.png"
width="150"
style="display:block;margin:auto;margin-bottom:10px;"
alt="Chatify"
/>

<div style="font-size:28px;font-weight:700;color:#ff6a00;">
Chatify Security Verification
</div>

</td>
</tr>

<tr>
<td style="text-align:center;padding:0 35px 30px 35px;">

<div style="font-size:16px;color:#555;line-height:26px;margin-bottom:30px;">
Security verification is required to protect your Chatify account.<br>
Please use the code below to confirm your identity and continue securely.
</div>

<div style="
display:inline-block;
background:#ff6a00;
padding:18px 60px;
border-radius:8px;
font-size:34px;
font-weight:700;
letter-spacing:8px;
color:#ffffff;
margin-bottom:25px;
">
${otp}
</div>

<div style="font-size:15px;color:#e53935;font-weight:600;margin-bottom:25px;">
⚠ Do NOT share this OTP with anyone
</div>

<hr style="border:none;border-top:1px solid #eee;margin:25px 0;">

<div style="font-size:14px;color:#777;line-height:22px;">
If this wasn't you, you can safely ignore this email.<br><br>
© ${new Date().getFullYear()} Chatify. All rights reserved.
</div>

</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>
`;
};


app.get('/app-version', (req, res) => {
  res.json({ 
    version: '2.9.11',   
    apk_url: 'https://github.com/chatify24/chatify_android/releases/download/v2.9.11/Chatify.apk'
  });
});
// Send OTP
app.post("/send-otp", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email required" });
  }

  const otp = Math.floor(100000 + Math.random() * 900000);
  otpStore[email] = {
  otp: otp.toString(),
  expiresAt: Date.now() + 5 * 60 * 1000 // 5 min expiry
};
// Reusable OTP Email Template

  try {
await sendEmail(email, "Your Chatify OTP Code", generateOtpTemplate(otp));

    res.json({ success: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Failed to send OTP" });
  }
});

// Verify OTP
app.post("/verify-otp", (req, res) => {
  const { email, otp } = req.body;

  const record = otpStore[email];

  if (!record) {
    return res.status(400).json({ error: "OTP not found" });
  }

  if (Date.now() > record.expiresAt) {
    delete otpStore[email];
    return res.status(400).json({ error: "OTP expired" });
  }

  if (record.otp !== otp) {
    return res.status(400).json({ error: "Invalid OTP" });
  }

  delete otpStore[email];
  res.json({ success: true });
});
app.post("/resend-otp", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email required" });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  otpStore[email] = {
    otp,
    expiresAt: Date.now() + 5 * 60 * 1000
  };

  try {
await sendEmail(email, "Your Chatify OTP Code", generateOtpTemplate(otp));

    res.json({ success: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Failed to resend OTP" });
  }
});
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback"
  },
  function(accessToken, refreshToken, profile, done) {
    return done(null, profile);
  }
));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

app.get("/auth/google", (req, res, next) => {
  const mode = req.query.mode || "login";

  passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "select_account",
    state: mode   // 🔥 IMPORTANT
  })(req, res, next);
});

app.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/" }),
  (req, res) => {
    const mode = req.query.state; // login या signup
    const email = req.user.emails[0].value; // Google से selected email

    // frontend को भेज दो
    res.redirect(`http://localhost:8080/google-auth?email=${encodeURIComponent(email)}&mode=${mode}`);
  }
);
app.post("/upload-profile", upload.single("image"), async (req, res) => {
  try {
    // 🔥 DEBUG
    console.log("CLOUDINARY CHECK:", {
      cloud_name: process.env.CLOUD_NAME || "MISSING",
      api_key: process.env.CLOUD_API_KEY ? "SET" : "MISSING",
      api_secret: process.env.CLOUD_API_SECRET ? "SET" : "MISSING",
    });

    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    const result = await new Promise((resolve, reject) => {
      cloudinary.v2.uploader
        .upload_stream(
          { folder: "chatify_profiles" },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        )
        .end(req.file.buffer);
    });

    res.json({ imageUrl: result.secure_url });

  } catch (err) {
    console.error("CLOUDINARY ERROR:", err?.message, JSON.stringify(err));
    res.status(500).json({ error: err?.message || "Upload failed" });
  }
});
app.post("/upload-audio", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio uploaded" });
    }

    const result = await new Promise((resolve, reject) => {
      cloudinary.v2.uploader
        .upload_stream(
          { 
            folder: "chatify_audio",
            resource_type: "video", // 🔥 audio ke liye yahi use hota hai
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        )
        .end(req.file.buffer);
    });

    res.json({ audioUrl: result.secure_url });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Audio upload failed" });
  }
});
// 🔥 Streaming audio upload - chunks real-time accept karta hai
// Session storage for chunks
if (!global.audioSessions) global.audioSessions = {};

app.post("/upload-audio-chunk", upload.single("chunk"), async (req, res) => {
  try {
    const sessionId = req.body.sessionId;
    const isLast = req.body.isLast === "true";

    if (!global.audioSessions[sessionId]) {
      global.audioSessions[sessionId] = [];
    }

    // Chunk store karo (agar data hai toh)
    if (req.file && req.file.buffer.length > 0) {
      global.audioSessions[sessionId].push(req.file.buffer);
    }

    if (!isLast) {
      return res.json({ done: false });
    }

    // 🔥 LAST CHUNK - Turant combine karo aur upload karo
    const fullBuffer = Buffer.concat(global.audioSessions[sessionId]);
    delete global.audioSessions[sessionId];

    // 🔥 Cloudinary pe directly stream karo - no temp file
    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.v2.uploader.upload_stream(
        { 
          folder: "chatify_audio",
          resource_type: "video",
          format: "webm",
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      uploadStream.end(fullBuffer);
    });

    delete global.audioSessions[sessionId]; // cleanup
    return res.json({ done: true, audioUrl: result.secure_url });

  } catch (err) {
    console.error("Chunk upload failed:", err);
    res.status(500).json({ error: "Chunk upload failed" });
  }
});
// 🔥 REAL FIX: Recording ke dauran hi Cloudinary upload stream open karo
const activeSessions = {}; // sessionId -> { uploadStream, resolve, reject, promise }

app.post("/upload-audio-start", (req, res) => {
  const { sessionId } = req.body;
  
  let resolver, rejecter;
  const promise = new Promise((resolve, reject) => {
    resolver = resolve;
    rejecter = reject;
  });

  const uploadStream = cloudinary.v2.uploader.upload_stream(
    { folder: "chatify_audio", resource_type: "video", format: "webm" },
    (error, result) => {
      if (error) rejecter(error);
      else resolver(result);
    }
  );

  activeSessions[sessionId] = { uploadStream, promise };
  
  res.json({ started: true });
});

app.post("/upload-audio-chunk", upload.single("chunk"), async (req, res) => {
  const { sessionId, isLast } = req.body;
  const session = activeSessions[sessionId];

  if (!session) {
    return res.status(400).json({ error: "Session not found" });
  }

  // 🔥 Chunk turant Cloudinary stream mein daal do
  if (req.file && req.file.buffer.length > 0) {
    session.uploadStream.write(req.file.buffer);
  }

  if (isLast === "true") {
    // 🔥 Stream close karo - Cloudinary finalize karega
    session.uploadStream.end();
    
    try {
      const result = await session.promise;
      delete activeSessions[sessionId];
      return res.json({ done: true, audioUrl: result.secure_url });
    } catch (err) {
      delete activeSessions[sessionId];
      return res.status(500).json({ error: "Upload failed" });
    }
  }

  res.json({ done: false });
});
app.post("/reset-password", async (req, res) => {

  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      error: "Email and password required"
    });
  }

  try {
    // Get user ID from profiles table
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .single();

    if (profileError || !profile) {
      return res.status(400).json({
        error: "User not found"
      });
    }

    // Update password using Supabase admin
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(profile.id, {
      password: password
    });

    if (updateError) {
      console.log("Password update error:", updateError);
      return res.status(500).json({
        error: "Failed to update password"
      });
    }

    res.json({
      success: true
    });

  } catch (err) {
    console.log("Reset password error:", err);
    res.status(500).json({
      error: "Server error"
    });
  }

});

// 🔌 SOCKET.IO SETUP
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Store online users
// Replace: const onlineUsers = new Map();
const onlineUsers = new Map(); // userId -> Map(socketId -> {name, avatar})

function addUserSocket(userId, socketId, name, avatar) {
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Map());
  onlineUsers.get(userId).set(socketId, { name, avatar });
}

function removeUserSocket(userId, socketId) {
  const sockets = onlineUsers.get(userId);
  if (sockets) {
    sockets.delete(socketId);
    if (sockets.size === 0) onlineUsers.delete(userId);
  }
}

function getUserSockets(userId) {
  const sockets = onlineUsers.get(userId);
  return sockets ? Array.from(sockets.keys()) : [];
}

function isUserOnline(userId) {
  return onlineUsers.has(userId) && onlineUsers.get(userId).size > 0;
}
const conversationRooms = new Map();

io.on("connection", async (socket) => {
  console.log("✅ New Socket.IO connection:", socket.id);

  // User comes online
  const userId = socket.handshake.auth.userId?.toLowerCase().trim();
  const userName = socket.handshake.auth.userName;
  const userAvatar = socket.handshake.auth.userAvatar;

if (userId) {
  const wasOnline = isUserOnline(userId);
  addUserSocket(userId, socket.id, userName, userAvatar);

  if (!wasOnline) {
    socket.broadcast.emit("user_online", userId);
  }

  supabaseAdmin
    .from("profiles")
    .update({ last_seen: new Date().toISOString() })
    .eq("email", userId)
    .then(({ error }) => {
      if (error) console.error("last_seen update error:", error);
    });
}



socket.on("edit_message", async (data) => {
  const { messageId, content, recipientId } = data;

  await supabaseAdmin
    .from("messages")
    .update({ content, edited: true })
    .eq("id", messageId);

  // 🔥 sender ke OTHER devices ko bhi update (khud ka current socket already local update kar chuka hai)
  const senderOtherSockets = getUserSockets(userId).filter((id) => id !== socket.id);
  senderOtherSockets.forEach((sockId) => {
    io.to(sockId).emit("message_edited", { messageId, content, edited: true });
  });

  // 🔥 receiver ke saare devices ko update
  const recipientSockets = getUserSockets(recipientId?.toLowerCase().trim());
  recipientSockets.forEach((sockId) => {
    io.to(sockId).emit("message_edited", { messageId, content, edited: true });
  });
});
  // Request pending messages
// server.js mein replace karo poora request_pending_messages handler

socket.on("request_pending_messages", async () => {
  try {
    const { data: pendingMessages, error } = await supabaseAdmin
      .from("messages")
      .select("*")
      .eq("receiver_email", userId)
      .or("deleted_for_receiver.is.null,deleted_for_receiver.eq.false")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("❌ Error fetching messages:", error);
      return;
    }

    if (pendingMessages && pendingMessages.length > 0) {
      const formattedMessages = pendingMessages.map((msg) => ({
        id: msg.id,
        senderId: msg.sender_id || msg.sender_email,
        senderName: msg.sender_name,
        senderAvatar: msg.sender_avatar,
        recipientId: msg.receiver_email,
        content: msg.content,        // ✅ Latest edited content DB se
        edited: msg.edited || false, // ✅ edited flag bhi bhejo
        timestamp: new Date(msg.created_at),
        conversationId: msg.conversation_id,
        status: msg.status || "delivered",
      }));

      socket.emit("pending_messages_batch", formattedMessages);

      // Sirf unread/sent wale update karo delivered mein
      const unreadIds = pendingMessages
        .filter(msg => ["sent", "delivered"].includes(msg.status) && !msg.read_at)
        .map(msg => msg.id);

      if (unreadIds.length > 0) {
        await supabaseAdmin
          .from("messages")
          .update({ status: "delivered" })
          .in("id", unreadIds);
      }
    }
  } catch (err) {
    console.error("❌ Error handling pending messages:", err);
  }
});

  // Request sent messages with read status
socket.on("request_sent_messages_status", async () => {
    try {
      console.log(`[v0] DEBUG: Client requested sent messages status for userId=${userId}`);
      
      const { data: sentMessages, error } = await supabaseAdmin
        .from("messages")
        .select("*")
        .eq("sender_email", userId)
        .or("deleted_for_sender.is.null,deleted_for_sender.eq.false")
        .order("created_at", { ascending: true });

      console.log(`[v0] DEBUG: Query for sent messages by userId='${userId}' - error=${error}, messages=${sentMessages?.length || 0}`);
      
      if (error) {
        console.error("❌ Error fetching sent messages:", error);
      } else if (sentMessages && sentMessages.length > 0) {
        console.log(`👁️ Found ${sentMessages.length} sent messages for ${userId}`);
        
        // Format and emit all sent messages with their current status
        const formattedMessages = sentMessages.map((msg) => {
          return {
            id: msg.id,
            senderId: msg.sender_id || msg.sender_email,
            senderName: msg.sender_name,
            senderAvatar: msg.sender_avatar,
            recipientId: msg.receiver_email,
            content: msg.content,
            timestamp: new Date(msg.created_at),
            conversationId: msg.conversation_id,
            status: msg.status, // 🔥 Include actual status from DB (sent/delivered/read)
            readAt: msg.read_at ? new Date(msg.read_at) : null,
          };
        });
        
        // Emit as a single batch event
        socket.emit("sent_messages_status_batch", formattedMessages);
        console.log(`✅ Sent ${formattedMessages.length} sent messages with status to client`);
      } else {
        console.log(`📭 No sent messages for ${userId}`);
      }
    } catch (err) {
      console.error("❌ Error handling sent messages status:", err);
    }
  });

  // Send message
  socket.on("send_message", async (data) => {
    try {
      const { conversationId, content, recipientId, timestamp, messageId } = data;
      const senderId = userId;
      const senderName = userName;
      const senderAvatar = userAvatar;

      // 🔥 Normalize recipient email
      const normalizedRecipientId = recipientId?.toLowerCase().trim();

      console.log(`[v0] DEBUG: send_message - from=${senderId} to=${normalizedRecipientId} conversationId=${conversationId}`);

      // 🔥 CHECK IF BLOCKED - Query recipient's blocked list
      const { data: recipientPrefs, error: blockError } = await supabaseAdmin
        .from("user_preferences")
        .select("blocked")
        .eq("user_id", normalizedRecipientId)
        .single();

      if (!blockError && recipientPrefs?.blocked && Array.isArray(recipientPrefs.blocked)) {
        const isBlocked = recipientPrefs.blocked.some((blockedEmail) => 
          blockedEmail.toLowerCase().trim() === senderId
        );
        if (isBlocked) {
          console.log(`🚫 Cannot send message: ${normalizedRecipientId} blocked ${senderId}`);
          socket.emit("message_blocked", { error: "User has blocked you" });
          return; // Don't send or save the message
        }
      }

      // Convert conversation_id string to valid UUID
      const conversationUUID = stringToUUID(conversationId);
      console.log(`[v0] DEBUG: Converted conversationId '${conversationId}' to UUID '${conversationUUID}'`);

      // Save message to database with status "sent"
      const { error, data: insertedData } = await supabaseAdmin
        .from("messages")
        .insert([
          {
            conversation_id: conversationUUID,
            sender_id: senderId,
            sender_email: senderId,
            sender_name: senderName,
            sender_avatar: senderAvatar,
            receiver_email: normalizedRecipientId, // 🔥 Use normalized recipient
            content: content,
            created_at: new Date(timestamp).toISOString(),
            status: "sent", // 🔥 Add delivery status
            read_at: null, // 🔥 Will be updated when recipient reads
          },
        ])
        .select();
        socket.emit("message_id_confirmed", {
  clientId: messageId,           // temp ID jo client ne banaya
  serverId: insertedData?.[0]?.id // DB ka real UUID
});

      if (error) {
        console.error("❌ Error saving message:", error);
      } else {
          console.log("✅ Inserted message ID:", insertedData?.[0]?.id);
  console.log("✅ Client temp ID:", messageId);
        console.log(`[v0] DEBUG: Message saved to DB - ID=${insertedData?.[0]?.id}, status=sent`);
      }

// Send message to recipient (all their devices)
      const recipientSockets = getUserSockets(normalizedRecipientId);
      const messagePayload = {
        id: insertedData?.[0]?.id,
        clientId: messageId,
        senderId,
        senderName,
        recipientId,
        senderAvatar,
        content,
        replyTo: data.replyTo,
        timestamp: new Date(timestamp),
        conversationId,
        status: "sent",
      };

      recipientSockets.forEach((sockId) => {
        io.to(sockId).emit("receive_message", messagePayload);
      });

     if (recipientSockets.length > 0) {
  console.log(`💬 Message sent from ${senderName} to ${recipientId}`);
} else {
  console.log(`⚠️ Recipient ${recipientId} is offline - message saved with status='sent'`);

  // 🔥 Recipient offline hai — push notification bhejo
  const { data: recipientProfile } = await supabaseAdmin
    .from("profiles")
    .select("fcm_token")
    .eq("email", normalizedRecipientId)
    .single();

  if (recipientProfile?.fcm_token) {
    let notifBody = content;
    try {
      const parsed = JSON.parse(content);
      notifBody = parsed.text || content;
    } catch {}
    if (notifBody?.startsWith("[IMAGE]")) notifBody = "📷 Photo";
    else if (notifBody?.startsWith("[AUDIO]")) notifBody = "🎤 Voice message";

    await sendPushNotification(recipientProfile.fcm_token, senderName, notifBody, senderId, false);
  } else {
    console.log(`⚠️ No FCM token found for ${normalizedRecipientId} - cannot send push`);
  }
}

      // 🔥 Sender ke OTHER devices ko bhi bhejo (phone→laptop sync)
      const senderOtherSockets = getUserSockets(senderId).filter((id) => id !== socket.id);
      senderOtherSockets.forEach((sockId) => {
        io.to(sockId).emit("receive_message", messagePayload);
      });
    } catch (err) {
      console.error("❌ Error handling message:", err);
      socket.emit("message_error", { error: "Failed to send message" });
    }
  });
       

  // Typing indicator
  socket.on("user_typing", (data) => {
    const { recipientId, isTyping } = data;
    const normalizedRecipient = recipientId?.toLowerCase().trim();
    const recipientSockets = getUserSockets(normalizedRecipient);

    recipientSockets.forEach((sockId) => {
      io.to(sockId).emit("user_typing", { userId, isTyping });
    });
  });

  // Delete message for everyone
socket.on("delete_message_for_everyone", async (data) => {
  try {
    const { recipientId, messageId } = data;
    const senderId = userId;
    
    console.log(`🗑️ BACKEND: delete_message_for_everyone - messageId: ${messageId}`);

    // 🔥 Sirf messages table mein soft delete - no message_deletes table
    const { error } = await supabaseAdmin
      .from("messages")
      .update({ 
        is_deleted: true,
        content: JSON.stringify({ text: "message deleted" })
      })
      .eq("id", messageId);

    if (error) {
      console.error("❌ Error soft deleting:", error);
    } else {
      console.log("✅ Message soft deleted in DB:", messageId);
    }

// Sender ka current socket confirm
    socket.emit("message_deleted_for_everyone", { messageId });

    // 🔥 Sender ke OTHER devices ko bhi bhejo
    const senderOtherSockets = getUserSockets(senderId).filter((id) => id !== socket.id);
    senderOtherSockets.forEach((sockId) => {
      io.to(sockId).emit("message_deleted_for_everyone", { messageId });
    });

    // Recipient ke saare devices ko bhejo
    const recipientSockets = getUserSockets(recipientId?.toLowerCase().trim());
    recipientSockets.forEach((sockId) => {
      io.to(sockId).emit("message_deleted_for_everyone", { messageId });
    });
    console.log(`✅ Delete event sent to recipient: ${recipientId}`);

  } catch (err) {
    console.error("❌ Error handling delete:", err);
  }
});

  // Mark messages as read
  socket.on("mark_messages_read", async (data) => {
    try {
      const { recipientId, messageIds, timestamp } = data;
      const readerId = userId;

      console.log(`👁️ BACKEND: Received read receipt - readerId: ${readerId}, messageIds:`, messageIds);

      // Update messages in database with read_at timestamp and status "read"
      const readTimestamp = new Date(timestamp).toISOString();
      const { error } = await supabaseAdmin
        .from("messages")
        .update({ 
          read_at: readTimestamp,
          status: "read" // 🔥 Update status to "read"
        })
        .in("id", messageIds);

      if (error) {
        console.error("❌ Error updating read status:", error);
      } else {
        console.log(`✅ BACKEND: Updated read status for ${messageIds.length} messages`);
      }

// Send read receipt to sender's (recipientId here = original sender) all devices
      const normalizedRecipient = recipientId?.toLowerCase().trim();
      const recipientSockets = getUserSockets(normalizedRecipient);

      recipientSockets.forEach((sockId) => {
        io.to(sockId).emit("messages_read", {
          messageIds,
          readerId,
          timestamp: readTimestamp,
          status: "read",
        });
      });

      // 🔥 Reader ke OTHER devices ko bhi sync karo (taki dusre device pe bhi "read" dikhe)
      const readerOtherSockets = getUserSockets(readerId).filter((id) => id !== socket.id);
      readerOtherSockets.forEach((sockId) => {
        io.to(sockId).emit("messages_read", {
          messageIds,
          readerId,
          timestamp: readTimestamp,
          status: "read",
        });
      });

      console.log(`[v0] Read receipt processed for ${recipientSockets.length} sender devices`);
    } catch (err) {
      console.error("❌ Error handling read receipt:", err);
    }
  });
socket.on("pin_message", async (data) => {
  const { recipientId, messageId, isPinned, contactKey } = data;

  const recipientSockets = getUserSockets(recipientId?.toLowerCase().trim());
  recipientSockets.forEach((sockId) => {
    io.to(sockId).emit("message_pinned", {
      messageId,
      isPinned,
      contactKey: userId,
    });
  });

  // 🔥 Sender ke OTHER devices ko bhi sync
  const senderOtherSockets = getUserSockets(userId).filter((id) => id !== socket.id);
  senderOtherSockets.forEach((sockId) => {
    io.to(sockId).emit("message_pinned", { messageId, isPinned, contactKey });
  });
});

  // Block user event
socket.on("block_user", async (data) => {
  try {
    const { recipientId } = data;
    const blockerUserId = userId;

    const normalizedRecipient = recipientId.toLowerCase().trim();

    console.log(`🚫 ${blockerUserId} blocked ${normalizedRecipient}`);

    // 1️⃣ Get current blocked list
    const { data: userPref, error: fetchError } = await supabaseAdmin
      .from("user_preferences")
      .select("blocked")
      .eq("user_id", blockerUserId)
      .single();

    if (fetchError) {
      console.error("❌ Fetch error:", fetchError);
      return;
    }

    const blockedList = userPref.blocked || [];

    // 2️⃣ Avoid duplicate
    const updatedBlocked = Array.from(new Set([
      ...blockedList,
      normalizedRecipient
    ]));

    // 3️⃣ Update DB
    const { error: updateError } = await supabaseAdmin
      .from("user_preferences")
      .update({ blocked: updatedBlocked })
      .eq("user_id", blockerUserId);

    if (updateError) {
      console.error("❌ Update error:", updateError);
    } else {
      console.log(`✅ Block updated in DB`);
    }

   // 4️⃣ Notify recipient (jisko block kiya) - saare devices
    const recipientSockets = getUserSockets(normalizedRecipient);
    recipientSockets.forEach((sockId) => {
      io.to(sockId).emit("user_blocked", {
        blockerUserId,
        recipientId: normalizedRecipient,
      });
    });
    console.log(`📤 Block notification sent to recipient ${normalizedRecipient}`);

    // 🔥 5️⃣ Same account ke doosre devices ko sync karo
    const blockerOtherSockets = getUserSockets(blockerUserId).filter((id) => id !== socket.id);
    blockerOtherSockets.forEach((sockId) => {
      io.to(sockId).emit("block_synced", {
        blockedUserId: normalizedRecipient,
        action: "block",
      });
    });
    console.log(`🔄 Block synced to other devices of ${blockerUserId}`);

  } catch (err) {
    console.error("❌ Error handling block user:", err);
  }
});

// Unblock user event
socket.on("unblock_user", async (data) => {
  try {
    const { recipientId } = data;
    const unblockerUserId = userId;

    const normalizedRecipient = recipientId.toLowerCase().trim();

    console.log(`✅ ${unblockerUserId} unblocked ${normalizedRecipient}`);

    // 1️⃣ Fetch current blocked list
    const { data: userPref, error: fetchError } = await supabaseAdmin
      .from("user_preferences")
      .select("blocked")
      .eq("user_id", unblockerUserId)
      .single();

    if (fetchError) {
      console.error("❌ Fetch error:", fetchError);
      return;
    }

    const blockedList = userPref.blocked || [];

    // 2️⃣ Remove user from blocked list
    const updatedBlocked = blockedList.filter(
      (email) => email.toLowerCase().trim() !== normalizedRecipient
    );

    // 3️⃣ Update DB
    const { error: updateError } = await supabaseAdmin
      .from("user_preferences")
      .update({ blocked: updatedBlocked })
      .eq("user_id", unblockerUserId);

    if (updateError) {
      console.error("❌ Update error:", updateError);
    } else {
      console.log(`✅ Unblock updated in DB`);
    }

    // 4️⃣ Notify recipient (jisko unblock kiya) - saare devices
    const recipientSockets = getUserSockets(normalizedRecipient);
    recipientSockets.forEach((sockId) => {
      io.to(sockId).emit("user_unblocked", {
        blockerUserId: unblockerUserId,
        recipientId: normalizedRecipient,
      });
    });
    console.log(`📤 Unblock notification sent to ${normalizedRecipient}`);

    // 🔥 5️⃣ Same account ke doosre devices ko sync karo
    const unblockerOtherSockets = getUserSockets(unblockerUserId).filter((id) => id !== socket.id);
    unblockerOtherSockets.forEach((sockId) => {
      io.to(sockId).emit("block_synced", {
        blockedUserId: normalizedRecipient,
        action: "unblock",
      });
    });
    console.log(`🔄 Unblock synced to other devices of ${unblockerUserId}`);

  } catch (err) {
    console.error("❌ Error handling unblock user:", err);
  }
});
  // User disconnects
socket.on("disconnect", () => {
  if (userId) {
    removeUserSocket(userId, socket.id);
    if (!isUserOnline(userId)) {
      socket.broadcast.emit("user_offline", userId);
    }
    console.log(`👋 ${userName} (${userId}) socket disconnected: ${socket.id}`);
  }
});

  socket.on("error", (error) => {
    console.error("❌ Socket error:", error);
  });
});
app.post("/group-message-webhook", async (req, res) => {
  try {
    const secret = req.headers["x-webhook-secret"];
    if (secret !== process.env.GROUP_WEBHOOK_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const payload = req.body;
    if (payload.type !== "INSERT" || payload.table !== "group_messages") {
      return res.status(200).json({ skipped: true });
    }

    const msg = payload.record;
    const isSystemMsg = typeof msg.content === "string" && msg.content.startsWith("[SYSTEM]");
    if (isSystemMsg) {
      return res.status(200).json({ skipped: true, reason: "system message" });
    }

    const { data: group } = await supabaseAdmin
      .from("groups")
      .select("name")
      .eq("id", msg.group_id)
      .single();

    const { data: senderProfile } = await supabaseAdmin
      .from("profiles")
      .select("name")
      .eq("email", msg.sender_email)
      .single();

    const senderName = senderProfile?.name || msg.sender_email;
    const groupName = group?.name || "Group";

    const { data: members } = await supabaseAdmin
      .from("group_members")
      .select("member_email")
      .eq("group_id", msg.group_id)
      .neq("member_email", msg.sender_email);

    if (!members || members.length === 0) {
      return res.status(200).json({ sent: 0 });
    }

    const memberEmails = members.map((m) => m.member_email);

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("email, fcm_token")
      .in("email", memberEmails);

    let notifBody = msg.content;
    if (notifBody?.startsWith("[IMAGE]")) notifBody = "📷 Photo";
    else if (notifBody?.startsWith("[AUDIO]")) notifBody = "🎤 Voice message";

    const title = groupName;
    const body = `${senderName}: ${notifBody}`;

    let sentCount = 0;
    for (const profile of profiles || []) {
      if (profile.fcm_token && !isUserOnline(profile.email.toLowerCase().trim())) {
        await sendPushNotification(profile.fcm_token, title, body, msg.group_id, true);
        sentCount++;
      }
    }

    res.json({ success: true, sent: sentCount });
  } catch (err) {
    console.error("❌ Group notification webhook error:", err);
    res.status(500).json({ error: "Server error" });
  }
});



// 🔥 GET BLOCKED USERS - Load blocks on initial page load
app.get("/get-blocked-users", async (req, res) => {
  try {
    const email = req.query.email;
    
    if (!email) {
      return res.status(400).json({ error: "Email required" });
    }

    const { data: usersData, error } = await supabaseAdmin
      .from("user_preferences")
      .select("user_id, blocked");

    if (error) {
      console.error("❌ Error fetching data:", error);
      return res.status(500).json({ error: "Failed to fetch blocks" });
    }

    // 🔥 FIXED STRUCTURE
    const blockedUsers = {};

(usersData || []).forEach((user) => {
  const blocker = user.user_id;
  const blockedList = user.blocked || [];

  if (!blockedUsers[blocker]) {
    blockedUsers[blocker] = [];
  }

  blockedUsers[blocker].push(...blockedList);
});

console.log(`✅ Loaded blocked users map:`, blockedUsers);

res.json({ blockedUsers });

  } catch (err) {
    console.error("❌ Error in get-blocked-users:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// 🔥 ACCEPT FRIEND REQUEST & ADD TO user_references
app.post("/accept-friend-request", async (req, res) => {
  try {
    const { requestId, senderEmail, receiverEmail } = req.body;

    if (!requestId || !senderEmail || !receiverEmail) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    console.log(`🤝 Accepting friend request: ${senderEmail} <-> ${receiverEmail}`);

    // Update request status
    const { error: updateError } = await supabaseAdmin
      .from("friend_requests")
      .update({ status: "accepted" })
      .eq("id", requestId);

    if (updateError) {
      console.error("❌ Error updating request:", updateError);
      return res.status(500).json({ error: "Failed to update request" });
    }

    // INSERT BOTH DIRECTIONS IN user_references
    const { error: insertError } = await supabaseAdmin
      .from("user_references")
      .insert([
        {
          user_id: senderEmail,
          referred_user_id: receiverEmail,
          relationship: "friend",
          created_at: new Date().toISOString(),
        },
        {
          user_id: receiverEmail,
          referred_user_id: senderEmail,
          relationship: "friend",
          created_at: new Date().toISOString(),
        },
      ]);

    if (insertError) {
      console.error("❌ Error inserting references:", insertError);
      return res.status(500).json({ error: "Failed to add friend reference" });
    }

    console.log(`✅ Friend reference added for both users`);
    res.json({ success: true, message: "Friend request accepted and references added" });
  } catch (err) {
    console.error("❌ Error in accept-friend-request:", err);
    res.status(500).json({ error: "Server error" });
  }
});
// NEW - add this route
app.post("/contact-form", async (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: "Name, email and message are required" });
  }

 const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Chatify Contact Form</title>
</head>

<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:40px 10px;">
<tr>
<td align="center">

<table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;">

<tr>
<td style="text-align:center;padding-bottom:20px;">

<img
src="https://res.cloudinary.com/dpaiyfwdu/image/upload/v1776595107/chatify_gzok1x.png"
width="150"
style="display:block;margin:auto;margin-bottom:10px;"
alt="Chatify"
/>

<div style="font-size:28px;font-weight:700;color:#ff6a00;">
New Contact Form Submission
</div>

</td>
</tr>

<tr>
<td style="text-align:left;padding:0 35px 30px 35px;">

<div style="font-size:15px;color:#555;line-height:24px;margin-bottom:20px;">
<strong style="color:#333;">Name:</strong> ${name}<br>
<strong style="color:#333;">Email:</strong> ${email}
</div>

<div style="
background:#fdf1e8;
border-radius:8px;
padding:20px;
font-size:15px;
color:#333;
line-height:24px;
white-space:pre-wrap;
margin-bottom:25px;
">
${message}
</div>

<hr style="border:none;border-top:1px solid #eee;margin:25px 0;">

<div style="font-size:14px;color:#777;line-height:22px;">
This message was submitted via the Chatify contact form.<br><br>
© ${new Date().getFullYear()} Chatify. All rights reserved.
</div>

</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>
`;

  try {
    await sendEmail("chatifyteam.24@gmail.com", `New Contact: ${name}`, html);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Contact form email failed:", err.message);
    res.status(500).json({ error: "Failed to send message" });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});


const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} with Socket.IO support`);
});
