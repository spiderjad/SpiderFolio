// Training (docs/spec/seguridad-salud.md): courses and in-person attendance.
import { z } from "zod";
import { pageShape } from "../../lib/pagination.ts";

const Id = z.string().min(1).max(64);
const Validity = z.number().int().min(1).max(120).nullable();

export const CoursesQuerySchema = z.object({ ...pageShape(["createdAt"], "createdAt") });

export const CourseSchema = z.strictObject({ nodeId: Id, validityMonths: Validity.default(null) });

export const UpdateCourseSchema = z.strictObject({ validityMonths: Validity });

export const AttendanceSchema = z.strictObject({
  membershipIds: z.array(Id).min(1).max(200),
  completedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
});
