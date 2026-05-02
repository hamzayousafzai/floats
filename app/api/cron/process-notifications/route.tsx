import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { Resend } from "resend";
import TwoDayReminderEmail from "@/components/emails/TwoDayReminderEmail";
import EventStartingEmail from "@/components/emails/EventStartingEmail";

export async function GET(request: Request) {
  // 1. Secure the endpoint with a secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 2. Guard env vars (prevents build/runtime crash when not configured)
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "RESEND_API_KEY is not configured" },
      { status: 500 }
    );
  }

  const resend = new Resend(apiKey);

  const supabaseAdmin = await createSupabaseAdmin();

  // 2. Fetch a batch of pending jobs using the RPC function
  const { data: jobs, error } = await supabaseAdmin.rpc('get_pending_notification_jobs', { p_limit: 10 });

  if (error) {
    console.error("Cron Error: Failed to fetch jobs", error);
    return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
  }

  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ ok: true, message: "No pending jobs to process." });
  }

  // 3. Process each job concurrently
  const processingPromises = jobs.map(async (job) => {
    try {
      const EmailComponent = job.notification_kind === 'reminder_48hr' 
        ? TwoDayReminderEmail 
        : EventStartingEmail;

      const subject = job.notification_kind === 'reminder_48hr' 
        ? `Reminder: ${job.event_title} is in 2 days!`
        : `Reminder: ${job.event_title} is starting soon!`;

      // Send the email
      await resend.emails.send({
        from: 'Floats <noreply@findfloats.com>', 
        to: [job.user_email],
        subject: subject,
        react: <EmailComponent eventTitle={job.event_title} eventId={job.event_id} />,
      });

      // 4. Mark job as 'sent' on success
      await supabaseAdmin
        .from('event_notification_queue')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', job.id);

    } catch (e: unknown) {
      console.error(`Cron Error: Failed to process job ${job.id}`, e);
      // 5. Mark job as 'failed' on error
      await supabaseAdmin
        .from('event_notification_queue')
        .update({ status: 'failed', error_message: e instanceof Error ? e.message : String(e) })
        .eq('id', job.id);
    }
  });

  await Promise.all(processingPromises);

  return NextResponse.json({ ok: true, processed: jobs.length });
}