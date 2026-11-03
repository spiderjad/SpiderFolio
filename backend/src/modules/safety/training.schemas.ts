// Training (docs/spec/seguridad-salud.md): courses and in-person attendance.
import { z } from "zod";
import { pageShape } from "../../lib/pagination.ts";

const Id = z.string().min(1).max(64);
const Validity = z.number().int().min(1).max(120).nullable();

export const CoursesQuerySchema = z.object({ ...pageShape(["createdAt"], "createdAt") });

export const CourseSchema = z.strictObject({ nodeId: Id, validityMonths: Validity.default(null) });

export const UpdateCourseSchema = z.strictObject({ validityMonths: Validity });

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
/** A PNG as a data URL: each attendee's signature (up to ~300 KB). */
const Signature = z
  .string()
  .max(400_000)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/u);

export const AttendanceSchema = z.strictObject({
  attendees: z
    .array(z.strictObject({ membershipId: Id, signature: Signature }))
    .min(1)
    .max(100),
  completedOn: Day,
});

export const PeopleQuerySchema = z.object({
  ...pageShape(["name"], "name"),
  q: z.string().trim().max(100).optional(),
  position: Id.optional(),
  department: Id.optional(),
  /** Only the people with that alert. */
  alert: z.enum(["ppe", "replace", "training", "fitness"]).optional(),
});

export const FitnessSchema = z.strictObject({
  status: z.enum(["APT", "APT_RESTRICTED", "NOT_APT"]),
  validUntil: Day.nullable().default(null),
  restrictions: z.string().trim().max(500).nullable().default(null),
});

export const AttendancePdfQuerySchema = z.object({ day: Day });
