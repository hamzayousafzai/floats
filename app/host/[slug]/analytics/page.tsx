"use client";

import {
	ChevronDown,
	ArrowUp,
	History,
	Download,
	Target,
} from "lucide-react";
import { useHost } from "@/lib/contexts/HostContext";

const stats = [
	{
		name: "Total Events",
		value: "12",
		change: "+2 this month",
		changeType: "positive",
	},
	{
		name: "Page Views",
		value: "2,456",
		change: "+12%",
		changeType: "positive",
	},
	{
		name: "Favorites",
		value: "189",
		change: "+8%",
		changeType: "positive",
	},
	{
		name: "Shares",
		value: "67",
		change: "3%",
		changeType: "neutral",
	},
];

const topEvents = [
	{
		rank: 1,
		name: "Front Porch Sundays",
		views: 856,
		favs: 92,
		shares: 34,
	},
	{
		rank: 2,
		name: "Nebel's Alley Night Market",
		views: 723,
		favs: 67,
		shares: 28,
	},
	{
		rank: 3,
		name: "Afternoon Craft Market",
		views: 542,
		favs: 45,
		shares: 19,
	},
];

// --- New Placeholder Data ---

const recentActivity = [
	{
		event: "Front Porch Sundays",
		action: "12 people favorited",
		time: "2 hours ago",
	},
	{
		event: "Nebel's Alley Night Market",
		action: "45 people viewed",
		time: "4 hours ago",
	},
	{
		event: "Afternoon Craft Market",
		action: "8 people shared",
		time: "6 hours ago",
	},
];

const engagementOverview = [
	{
		label: "Average Event Attendance",
		value: "85%",
		progress: 85,
		color: "progress-primary",
	},
	{
		label: "Conversion Rate (Views to Favorites)",
		value: "7.7%",
		progress: 77,
		color: "progress-success",
	},
	{
		label: "Share Rate",
		value: "2.7%",
		progress: 27,
		color: "progress-primary",
	},
];

const quickActions = [
	{
		title: "Export Analytics Report",
		description:
			"Download detailed analytics for the last 30 days",
		icon: Download,
	},
	{
		title: "Set up Analytics Goals",
		description:
			"Create goals to track your performance",
		icon: Target,
	},
];

export default function AnalyticsPage() {
	const { currentOrg } = useHost();

	return (
		<div className="bg-gray-50 min-h-full">
			<div className="p-4 sm:p-6 space-y-6">
				{/* Header */}
				<div className="flex justify-between items-center">
					<h1 className="text-2xl font-bold">Analytics</h1>
					<div className="dropdown dropdown-end">
						<label tabIndex={0} className="btn btn-outline btn-sm">
							Last 30 days
							<ChevronDown size={16} />
						</label>
						<ul
							tabIndex={0}
							className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52"
						>
							<li>
								<a>Last 7 days</a>
							</li>
							<li>
								<a>Last 30 days</a>
							</li>
							<li>
								<a>Last 90 days</a>
							</li>
						</ul>
					</div>
				</div>

				{/* Stat Cards */}
				<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
					{stats.map((stat) => (
						<div
							key={stat.name}
							className="bg-white p-4 rounded-lg shadow"
						>
							<p className="text-sm text-gray-500">{stat.name}</p>
							<p className="text-2xl font-bold mt-1">{stat.value}</p>
							<p
								className={`text-xs mt-1 flex items-center ${
									stat.changeType === "positive"
										? "text-green-600"
										: "text-gray-500"
								}`}
							>
								{stat.changeType === "positive" && (
									<ArrowUp size={12} className="mr-1" />
								)}
								{stat.change}
							</p>
						</div>
					))}
				</div>

				{/* Top Performing Events */}
				<div className="bg-white p-6 rounded-lg shadow">
					<h2 className="text-lg font-semibold mb-4">
						Top Performing Events
					</h2>
					<div className="space-y-4">
						{topEvents.map((event) => (
							<div key={event.rank} className="flex items-center gap-4">
								<div className="text-lg font-bold text-gray-400">
									{event.rank}
								</div>
								<div className="flex-grow">
									<p className="font-medium">{event.name}</p>
									<p className="text-xs text-gray-500">
										{event.views} views · {event.favs} favs ·{" "}
										{event.shares} shares
									</p>
								</div>
							</div>
						))}
					</div>
				</div>

				{/* --- New Components Start Here --- */}

				{/* Recent Activity */}
				<div className="bg-white p-6 rounded-lg shadow">
					<h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
						<History size={20} />
						Recent Activity
					</h2>
					<div className="space-y-4">
						{recentActivity.map((activity) => (
							<div
								key={activity.event}
								className="flex justify-between items-center"
							>
								<div>
									<p className="font-medium">{activity.event}</p>
									<p className="text-sm text-gray-500">
										{activity.action}
									</p>
								</div>
								<p className="text-sm text-gray-400">
									{activity.time}
								</p>
							</div>
						))}
					</div>
				</div>

				{/* Engagement Overview */}
				<div className="bg-white p-6 rounded-lg shadow">
					<h2 className="text-lg font-semibold mb-4">
						Engagement Overview
					</h2>
					<div className="space-y-4">
						{engagementOverview.map((metric) => (
							<div key={metric.label}>
								<div className="flex justify-between text-sm mb-1">
									<span className="text-gray-600">{metric.label}</span>
									<span className="font-medium">{metric.value}</span>
								</div>
								<progress
									className={`progress ${metric.color} w-full`}
									value={metric.progress}
									max="100"
								></progress>
							</div>
						))}
					</div>
				</div>

				{/* Quick Actions */}
				<div className="bg-white p-6 rounded-lg shadow">
					<h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
					<div className="divide-y divide-gray-200">
						{quickActions.map((action) => (
							<div
								key={action.title}
								className="flex items-center gap-4 py-3 cursor-pointer hover:bg-gray-50"
							>
								<action.icon size={20} className="text-gray-500" />
								<div>
									<p className="font-medium">{action.title}</p>
									<p className="text-sm text-gray-500">
										{action.description}
									</p>
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}