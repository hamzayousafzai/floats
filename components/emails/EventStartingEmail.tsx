import * as React from 'react';

interface EmailProps {
  eventTitle: string;
  eventId: string;
}

export const EventStartingEmail: React.FC<Readonly<EmailProps>> = ({ eventTitle, eventId }) => (
  <div>
    <h1>{eventTitle} is starting soon!</h1>
    <p>
      The event you&apos;re following, <strong>{eventTitle}</strong>, is about to begin.
    </p>
    <p>
      We hope you have a great time!
    </p>
    <p>
      <a href={`https://findfloats.com/events/${eventId}`}>View Event Details</a>
    </p>
    <hr />
    <p>
      <small>To unsubscribe from these reminders, please visit the event page and turn off notifications.</small>
    </p>
  </div>
);

export default EventStartingEmail;