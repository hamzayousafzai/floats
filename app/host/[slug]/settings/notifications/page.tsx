"use client";

const notificationSettings = [
	{
		id: "event-updates",
		title: "Event Updates",
		description: "Get notified when events are published or updated",
		checked: true,
	},
	{
		id: "team-invitations",
		title: "Team Invitations",
		description: "Notifications for new team member invitations",
		checked: true,
	},
	{
		id: "analytics-reports",
		title: "Analytics Reports",
		description: "Weekly analytics summary emails",
		checked: false,
	},
];

export default function NotificationsSettingsPage() {
	// In a real app, you would manage the state of these checkboxes.
	// const [settings, setSettings] = useState(notificationSettings);

	return (
		<div className="bg-white p-6 rounded-lg shadow">
			<h2 className="text-lg font-semibold mb-4">Email Notifications</h2>
			<div className="divide-y divide-gray-200">
				{notificationSettings.map((setting) => (
					<div
						key={setting.id}
						className="flex items-center justify-between py-4"
					>
						<div>
							<label
								htmlFor={setting.id}
								className="font-medium cursor-pointer"
							>
								{setting.title}
							</label>
							<p className="text-sm text-gray-500">
								{setting.description}
							</p>
						</div>
						<input
							id={setting.id}
							type="checkbox"
							defaultChecked={setting.checked}
							className="checkbox checkbox-warning"
						/>
					</div>
				))}
			</div>
		</div>
	);
}