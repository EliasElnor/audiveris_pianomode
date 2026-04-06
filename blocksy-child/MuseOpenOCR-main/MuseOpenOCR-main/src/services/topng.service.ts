process.env.PATH =
  process.env.PATH +
  ";C:\\Program Files\\GraphicsMagick-1.3.46-Q16";

import { fromPath } from 'pdf2pic';
import { writeFileSync, mkdirSync, existsSync, renameSync } from 'fs';
import { tesseractService } from './tesseract/ocr.service.js';
import path from 'path';

export async function toPngService(file: Express.Multer.File) {
    console.log("Service: Processando o arquivo PDF:", file.originalname);

    const pdfDir = path.join(process.cwd(), './src/storage/pdf_source');
    const pngDir = path.join(process.cwd(), './src/storage/converted_images');
    const pdfPath = path.join(pdfDir, file.originalname);// ./src/storage/pdf_source/pdf.pdf

    // Garantir que os diretórios existam
    if (!existsSync(pdfDir)) mkdirSync(pdfDir, { recursive: true });
    if (!existsSync(pngDir)) mkdirSync(pngDir, { recursive: true });

    try { // Salvar o arquivo PDF no sistema de arquivos
        writeFileSync(pdfPath, file.buffer);
        console.log("Arquivo PDF salvo em:", pdfPath);
    } catch (error) {
        console.error("Erro ao salvar o arquivo PDF:", error);
    }

    try { // Converter PDF para PNG
        const convert = fromPath(pdfPath, {
            format: 'png',
            savePath: pngDir,
            width: 800,
            height: 1000,
        });
        const result = await convert(1);
        renameSync(pngDir + '/' + result.name,pngDir + '/' + file.originalname.replace('.pdf', '.png'));
        const pngPath = path.join(pngDir, file.originalname.replace('.pdf', '.png'));
        console.log("Arquivo PDF convertido para PNG:", result);
        tesseractService(pngPath)

    } catch (error) {
        console.error("Erro ao converter o arquivo PDF:", error);
    }
} 