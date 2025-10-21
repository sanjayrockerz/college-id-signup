import { Router } from "express";

// Legacy route decommissioned; respond with Gone for any usage.
const router = Router();

router.use((req, res) => {
  res.status(410).json({
    success: false,
    message: "ID card verification feature has been removed",
    path: req.path,
  });
});

export default router;
