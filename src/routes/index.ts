import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate, requirePermission as can } from "../middlewares/auth";
import * as A from "../controllers/auth.controller";
import * as U from "../controllers/user.controller";
import * as E from "../controllers/equipment.controller";
import * as M from "../controllers/misc.controller";

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts. Please try again later." },
});

const auth = Router();
auth.post("/login", limiter, A.login);
auth.post("/logout", A.logout);
auth.post("/refresh", A.refresh);
auth.post("/forgot-password", limiter, A.forgotPassword);
auth.post("/reset-password", limiter, A.resetPassword);
auth.get("/invitation", A.invitationInfo);
auth.post("/activate", limiter, A.activate);
auth.get("/me", authenticate, A.me);

const users = Router();
users.get("/", can("USER_VIEW"), U.list);
users.post("/", can("USER_CREATE"), U.create);
users.get("/:id", can("USER_VIEW"), U.get);
users.patch("/:id", can("USER_UPDATE"), U.update);
users.post("/:id/deactivate", can("USER_DEACTIVATE"), U.deactivate);
users.post("/:id/reactivate", can("USER_DEACTIVATE"), U.reactivate);
users.post("/:id/resend-invitation", can("USER_CREATE"), U.resend);

const equipment = Router();
equipment.get("/", can("EQUIPMENT_VIEW"), E.list);
equipment.post("/", can("EQUIPMENT_CREATE"), E.create);
equipment.get("/:id", can("EQUIPMENT_VIEW"), E.get);
equipment.patch("/:id", can("EQUIPMENT_UPDATE"), E.update);
equipment.delete("/:id", can("EQUIPMENT_DELETE"), E.retire);
equipment.get("/:id/history", can("HISTORY_VIEW"), E.history);
equipment.get("/:id/maintenance", can("MAINTENANCE_VIEW"), E.maintenanceList);
equipment.post(
  "/:id/maintenance",
  can("MAINTENANCE_CREATE"),
  E.maintenanceCreate,
);
equipment.post("/:id/assign", can("EQUIPMENT_ASSIGN"), E.assign);
equipment.post("/:id/transfer", can("EQUIPMENT_TRANSFER"), E.transfer);

const api = Router();
api.use("/auth", auth);
api.use("/users", authenticate, users);
api.use("/equipment", authenticate, equipment);
api.get("/dashboard/stats", authenticate, can("DASHBOARD_VIEW"), M.dashboard);
api.get("/roles", authenticate, can("USER_VIEW"), M.roles);
api.get("/permissions", authenticate, can("USER_VIEW"), M.permissions);
api.get("/departments", authenticate, can("EQUIPMENT_VIEW"), M.departments);
api.post(
  "/departments",
  authenticate,
  can("MASTERDATA_MANAGE"),
  M.createDepartment,
);
api.get("/locations", authenticate, can("EQUIPMENT_VIEW"), M.locations);
api.post(
  "/locations",
  authenticate,
  can("MASTERDATA_MANAGE"),
  M.createLocation,
);
api.get("/staff", authenticate, can("EQUIPMENT_VIEW"), M.staff);
api.post("/staff", authenticate, can("MASTERDATA_MANAGE"), M.createStaff);
api.get("/audit-logs", authenticate, can("AUDIT_LOG_VIEW"), M.auditLogs);
api.get(
  "/audit-logs/actions",
  authenticate,
  can("AUDIT_LOG_VIEW"),
  M.auditActions,
);

export default api;
