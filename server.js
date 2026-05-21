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
    console.error(err);
    res.status(500).json({ error: "Upload failed" });
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
const onlineUsers = new Map();
const conversationRooms = new Map();

io.on("connection", async (socket) => {
  console.log("✅ New Socket.IO connection:", socket.id);

  // User comes online
  const userId = socket.handshake.auth.userId?.toLowerCase().trim();
  const userName = socket.handshake.auth.userName;
  const userAvatar = socket.handshake.auth.userAvatar;

  if (userId) {
    onlineUsers.set(userId, {
      socketId: socket.id,
      name: userName,
      avatar: userAvatar,
    });

    // Notify others that user is online
    socket.broadcast.emit("user_online", userId);
    console.log(`👤 ${userName} (${userId}) is now online`);
  }

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log("❌ Socket.IO disconnect:", socket.id);
    // Remove from online users
    for (const [email, user] of onlineUsers.entries()) {
      if (user.socketId === socket.id) {
        onlineUsers.delete(email);
        // Notify others that user is offline
        socket.broadcast.emit("user_offline", email);
        console.log(`👤 ${email} is now offline`);
        break;
      }
    }
  });
  socket.on("edit_message", async (data) => {
  const { messageId, content, recipientId } = data;

  // 🔥 DB update
  await supabaseAdmin
    .from("messages")
    .update({ 
  content,
  edited: true   // 🔥 ADD THIS
})
    .eq("id", messageId);

  // 🔥 sender ko update
  socket.emit("message_edited", { messageId, content ,edited:true});

  // 🔥 receiver ko update
  const recipient = onlineUsers.get(recipientId?.toLowerCase().trim());

  if (recipient) {
    io.to(recipient.socketId).emit("message_edited", {
      messageId,
      content,
    });
  }
});
  // Request pending messages
// server.js mein replace karo poora request_pending_messages handler

socket.on("request_pending_messages", async () => {
  try {
    const { data: pendingMessages, error } = await supabaseAdmin
      .from("messages")
      .select("*")
      .eq("receiver_email", userId)
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

      // Send message to recipient
      const recipient = onlineUsers.get(normalizedRecipientId);
      if (recipient) {
        io.to(recipient.socketId).emit("receive_message", {
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
          status: "sent", // 🔥 Mark as delivered to recipient
        });
        console.log(`💬 Message sent from ${senderName} to ${recipientId}`);
      } else {
        console.log(`⚠️ Recipient ${recipientId} is offline - message saved with status='sent'`);
      }
    } catch (err) {
      console.error("❌ Error handling message:", err);
      socket.emit("message_error", { error: "Failed to send message" });
    }
  });
       

  // Typing indicator
  socket.on("user_typing", (data) => {
    const { recipientId, isTyping } = data;
    const normalizedRecipient = recipientId?.toLowerCase().trim();
const recipient = onlineUsers.get(normalizedRecipient);

console.log("🎯 Looking for:", normalizedRecipient);
console.log("📡 Available users:", Array.from(onlineUsers.keys()));
    if (recipient) {
      io.to(recipient.socketId).emit("user_typing", {
        userId,
        isTyping,
      });
    }
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
        content: "message deleted"
      })
      .eq("id", messageId);

    if (error) {
      console.error("❌ Error soft deleting:", error);
    } else {
      console.log("✅ Message soft deleted in DB:", messageId);
    }

    // Sender ko confirm karo
    socket.emit("message_deleted_for_everyone", { messageId });

    // Recipient online hai toh usse bhi bhejo
    const recipient = onlineUsers.get(recipientId?.toLowerCase().trim());
    if (recipient) {
      io.to(recipient.socketId).emit("message_deleted_for_everyone", { messageId });
      console.log(`✅ Delete event sent to recipient: ${recipientId}`);
    } else {
      console.log(`⚠️ Recipient ${recipientId} offline - DB already updated`);
    }

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

      // Send read receipt to sender with timestamp
      const normalizedRecipient = recipientId?.toLowerCase().trim();
      const recipient = onlineUsers.get(normalizedRecipient);
      console.log(`[v0] 👁️  BACKEND: Received read from ${readerId}, sending receipt to sender ${recipientId}`);
      console.log("[v0] BACKEND: Looking for recipient:", recipientId, "Normalized:", normalizedRecipient, "Found:", !!recipient);
      console.log("[v0] BACKEND: Online users:", Array.from(onlineUsers.keys()));
      if (recipient) {
        io.to(recipient.socketId).emit("messages_read", {
          messageIds,
          readerId,
          timestamp: readTimestamp,
          status: "read",
        });
        console.log(`[v0] ✅ BACKEND: Read receipt SENT to ${recipientId} for ${messageIds.length} messages`);
      } else {
        console.log(`[v0] ⚠️  BACKEND: Sender ${recipientId} is OFFLINE - will sync when they come online`);
      }
    } catch (err) {
      console.error("❌ Error handling read receipt:", err);
    }
  });
  socket.on("pin_message", async (data) => {
  const { recipientId, messageId, isPinned, contactKey } = data;
  
  // Save to DB (optional but recommended)
  // ...

  // Notify recipient if online
  const recipient = onlineUsers.get(recipientId?.toLowerCase().trim());
  if (recipient) {
    io.to(recipient.socketId).emit("message_pinned", {
  messageId,
  isPinned,
  contactKey: userId, // ✅ sender ki socket userId = sender ka email
});
  }
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

    // 4️⃣ Notify recipient (jisko block kiya)
    const recipient = onlineUsers.get(normalizedRecipient);
    if (recipient) {
      io.to(recipient.socketId).emit("user_blocked", {
        blockerUserId,
        recipientId: normalizedRecipient,
      });
      console.log(`📤 Block notification sent to recipient ${normalizedRecipient}`);
    }

    // 🔥 5️⃣ Same account ke doosre browsers/tabs ko sync karo
    for (const [email, onlineUser] of onlineUsers.entries()) {
      if (
        email === blockerUserId &&
        onlineUser.socketId !== socket.id
      ) {
        io.to(onlineUser.socketId).emit("block_synced", {
          blockedUserId: normalizedRecipient,
          action: "block",
        });
        console.log(`🔄 Block synced to another tab of ${blockerUserId}`);
      }
    }

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

    // 4️⃣ Notify recipient (jisko unblock kiya)
    const recipient = onlineUsers.get(normalizedRecipient);
    if (recipient) {
      io.to(recipient.socketId).emit("user_unblocked", {
        blockerUserId: unblockerUserId,
        recipientId: normalizedRecipient,
      });
      console.log(`📤 Unblock notification sent to ${normalizedRecipient}`);
    }

    // 🔥 5️⃣ Same account ke doosre browsers/tabs ko sync karo
    for (const [email, onlineUser] of onlineUsers.entries()) {
      if (
        email === unblockerUserId &&
        onlineUser.socketId !== socket.id
      ) {
        io.to(onlineUser.socketId).emit("block_synced", {
          blockedUserId: normalizedRecipient,
          action: "unblock",
        });
        console.log(`🔄 Unblock synced to another tab of ${unblockerUserId}`);
      }
    }

  } catch (err) {
    console.error("❌ Error handling unblock user:", err);
  }
});
  // User disconnects
  socket.on("disconnect", () => {
    if (userId && onlineUsers.has(userId)) {
      onlineUsers.delete(userId);
      socket.broadcast.emit("user_offline", userId);
      console.log(`👋 ${userName} (${userId}) is now offline`);
    }
  });

  socket.on("error", (error) => {
    console.error("❌ Socket error:", error);
  });
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


const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} with Socket.IO support`);
});
