import * as React from 'react';

interface EmailProps {
  eventTitle: string;
  eventId: string;
}

export const TwoDayReminderEmail: React.FC<Readonly<EmailProps>> = ({ eventTitle, eventId }) => (
  <div>
    <h1>Reminder for {eventTitle}</h1>
    <p>
      This is a friendly reminder that the event you're following, <strong>{eventTitle}</strong>, is happening in two days!
    </p>
    <p>
      You can view the event details here: 
      <a href={`https://findfloats.com/events/${eventId}`}>View Event</a>
    </p>
    <hr />
    <p>
      <small>To unsubscribe from these Floats reminders, please visit the event page and turn off notifications.</small>
    </p>
  </div>
);

export default TwoDayReminderEmail;