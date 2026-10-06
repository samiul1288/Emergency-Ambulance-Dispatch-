import { Router } from "express";
import { auth } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validateRequest.js";
import { getMe, updateMe } from "./user.controller.js";
import { updateProfileSchema } from "./user.validation.js";

const userRouter: Router = Router();

// Every authenticated role (PATIENT / DRIVER / ADMIN) may read and
// update their own profile — ownership is implicit via the token.
userRouter.use(auth());

userRouter.get("/me", getMe);

userRouter.patch(
  "/me",
  validateRequest({ body: updateProfileSchema }),
  updateMe,
);

export default userRouter;

