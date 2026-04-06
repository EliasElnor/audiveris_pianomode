import { Router } from "express";
import { pdfController } from "../controllers/pdf.controller.js";
import { upload } from "../middlewares/upload.js";
export const router = Router();

router.post(
  "/upload", 
  upload.single('file'), 
  pdfController,
);