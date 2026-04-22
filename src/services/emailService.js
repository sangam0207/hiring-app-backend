const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
  if (!transporter) {
    console.log("[Email] Creating transporter with user:", process.env.SMTP_USER);
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

const sendInterviewEmail = async ({ to, candidateName, jobTitle, company, interviewDate, interviewTime, duration, meetingLink, notes }) => {
  console.log("[Email] sendInterviewEmail called, to:", to);
  console.log("[Email] SMTP_USER:", process.env.SMTP_USER ? "set" : "NOT SET");
  console.log("[Email] SMTP_PASS:", process.env.SMTP_PASS ? "set" : "NOT SET");

  // Skip if SMTP is not configured
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log("[Email] SMTP not configured — skipping email to", to);
    return;
  }

  const mailOptions = {
    from: `"${company || 'HiringPulse'}" <${process.env.SMTP_USER}>`,
    to,
    subject: `Interview Scheduled — ${jobTitle}`,
    html: `
      <div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
        <div style="height:4px;background:linear-gradient(90deg,#6c8eff,#a78bfa,#22d3ee)"></div>
        <div style="padding:32px 28px">
          <h1 style="font-size:22px;color:#111827;margin:0 0 8px">Interview Scheduled</h1>
          <p style="font-size:15px;color:#6b7280;margin:0 0 24px">Hi ${candidateName},</p>

          <p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 20px">
            Great news! Your interview for <strong>${jobTitle}</strong>${company ? ` at <strong>${company}</strong>` : ''} has been scheduled. Here are the details:
          </p>

          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin-bottom:20px">
            <table style="width:100%;border-collapse:collapse">
              <tr>
                <td style="padding:6px 0;font-size:13px;color:#6b7280;width:100px">Date</td>
                <td style="padding:6px 0;font-size:14px;color:#111827;font-weight:600">${interviewDate}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;font-size:13px;color:#6b7280">Time</td>
                <td style="padding:6px 0;font-size:14px;color:#111827;font-weight:600">${interviewTime}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;font-size:13px;color:#6b7280">Duration</td>
                <td style="padding:6px 0;font-size:14px;color:#111827;font-weight:600">${duration} minutes</td>
              </tr>
              ${notes ? `<tr>
                <td style="padding:6px 0;font-size:13px;color:#6b7280;vertical-align:top">Notes</td>
                <td style="padding:6px 0;font-size:14px;color:#374151">${notes}</td>
              </tr>` : ''}
            </table>
          </div>

          <a href="${meetingLink}" target="_blank"
            style="display:inline-block;padding:12px 28px;background:#6c8eff;color:white;font-size:14px;font-weight:700;text-decoration:none;border-radius:8px;text-align:center">
            Join Interview
          </a>

          <p style="font-size:13px;color:#9ca3af;margin:20px 0 0;line-height:1.6">
            If the button doesn't work, copy this link:<br/>
            <a href="${meetingLink}" style="color:#6c8eff;word-break:break-all">${meetingLink}</a>
          </p>

          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 16px"/>
          <p style="font-size:12px;color:#9ca3af;margin:0">
            This is an automated message from HiringPulse. Please do not reply to this email.
          </p>
        </div>
      </div>
    `,
  };

  try {
    const info = await getTransporter().sendMail(mailOptions);
    console.log("[Email] Interview email sent to", to, "messageId:", info.messageId);
  } catch (error) {
    console.error("[Email] Failed to send interview email:", error.message);
    console.error("[Email] Full error:", error);
  }
};

const sendAIInterviewEmail = async ({ to, candidateName, jobTitle, company, deadline }) => {
  console.log("[Email] sendAIInterviewEmail called, to:", to);

  // Skip if SMTP is not configured
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log("[Email] SMTP not configured — skipping email to", to);
    return;
  }

  const deadlineDate = new Date(deadline).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const deadlineTime = new Date(deadline).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const mailOptions = {
    from: `"${company || 'HiringPulse'}" <${process.env.SMTP_USER}>`,
    to,
    subject: `AI Interview Invitation — ${jobTitle}`,
    html: `
      <div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
        <div style="height:4px;background:linear-gradient(90deg,#6c8eff,#a78bfa,#22d3ee)"></div>
        <div style="padding:32px 28px">
          <h1 style="font-size:22px;color:#111827;margin:0 0 8px">🤖 AI Interview Invitation</h1>
          <p style="font-size:15px;color:#6b7280;margin:0 0 24px">Hi ${candidateName},</p>

          <p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 20px">
            Great news! You've been invited to take an <strong>AI-powered interview</strong> for
            <strong>${jobTitle}</strong>${company ? ` at <strong>${company}</strong>` : ''}.
          </p>

          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin-bottom:20px">
            <h3 style="font-size:14px;color:#374151;margin:0 0 12px">What to expect:</h3>
            <ul style="margin:0;padding:0 0 0 18px;font-size:14px;color:#4b5563;line-height:2">
              <li>5 AI-generated questions tailored to the role</li>
              <li>Answer using <strong>voice</strong> (speech-to-text) or <strong>typing</strong></li>
              <li>3-minute time limit per question</li>
              <li><strong>Camera required</strong> — keep your camera on throughout the interview</li>
              <li>AI evaluates your responses instantly</li>
            </ul>
          </div>

          <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:10px;padding:16px;margin-bottom:20px">
            <p style="font-size:14px;color:#92400e;margin:0;font-weight:600">
              ⏰ Deadline: ${deadlineDate} at ${deadlineTime}
            </p>
            <p style="font-size:13px;color:#a16207;margin:6px 0 0">
              Please complete your interview before this deadline. After this time, the interview will expire.
            </p>
          </div>

          <p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 20px">
            Log in to your account and go to <strong>My Applications</strong> to start the interview.
          </p>

          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 16px"/>
          <p style="font-size:12px;color:#9ca3af;margin:0">
            This is an automated message from HiringPulse. Please do not reply to this email.
          </p>
        </div>
      </div>
    `,
  };

  try {
    const info = await getTransporter().sendMail(mailOptions);
    console.log("[Email] AI Interview email sent to", to, "messageId:", info.messageId);
  } catch (error) {
    console.error("[Email] Failed to send AI interview email:", error.message);
  }
};

module.exports = { sendInterviewEmail, sendAIInterviewEmail };
