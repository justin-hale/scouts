import type { CalendarData } from "../types";

/**
 * Seed data used by the localStorage dev fallback (no Worker configured) and
 * as the initial contents when you first create the Gist. Edit freely.
 */
export const sampleData: CalendarData = {
  categories: [
    { id: "den", name: "Den Meeting", color: "#2563eb" },
    { id: "pack", name: "Pack Meeting", color: "#16a34a" },
    { id: "campout", name: "Campout", color: "#b45309" },
    { id: "service", name: "Service Project", color: "#9333ea" },
    { id: "fundraiser", name: "Fundraiser", color: "#dc2626" },
  ],
  events: [
    {
      id: "evt-1",
      title: "Weekly Den Meeting",
      date: "2026-06-04",
      allDay: false,
      startTime: "18:30",
      endTime: "19:30",
      location: "Community Center, Room B",
      description:
        "Working on the **Bobcat** badge. Bring your handbook!\n\nDetails: https://example.com/bobcat",
      categoryId: "den",
    },
    {
      id: "evt-2",
      title: "Pack Meeting & Pinewood Derby",
      date: "2026-06-12",
      allDay: false,
      startTime: "18:00",
      endTime: "20:00",
      location: "Elementary School Gym",
      description:
        "Race day! Cars must be checked in by 5:45 PM.\n\n- Weigh-in at the door\n- Awards after racing",
      categoryId: "pack",
    },
    {
      id: "evt-3",
      title: "Family Campout",
      date: "2026-06-20",
      allDay: true,
      startTime: "",
      endTime: "",
      location: "Cedar Ridge State Park",
      description:
        "Overnight campout. Pack tents, sleeping bags, and a camp chair. Dinner provided Saturday.",
      categoryId: "campout",
    },
    {
      id: "evt-4",
      title: "Park Cleanup Service Project",
      date: "2026-06-27",
      allDay: false,
      startTime: "09:00",
      endTime: "11:00",
      location: "Riverside Park, North Lot",
      description: "Gloves and bags provided. Wear closed-toe shoes.",
      categoryId: "service",
    },
  ],
};
