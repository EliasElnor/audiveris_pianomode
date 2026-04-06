import { toPngService } from "../services/topng.service.js";
export async function pdfController(req: any, res: any) {
    const file = req.file;
    console.log(req.file);

    // Lógica para processar o arquivo PDF
    if (!file) { // Verifica se o arquivo foi enviado
        res.status(400).json({ error: "Nenhum arquivo enviado para processamento." });
        return;
    }

    if(file.mimetype !== 'application/pdf') { // Verifica se o arquivo é um PDF
        
        res.status(415).json({ error: "Arquivo enviado não é um PDF válido." });
        return;
    }

    console.log("Controller:Processando o arquivo PDF:", file.originalname);

    try {
        await toPngService(file);

        res.status(200).json({
            message: "Arquivo PDF recebido está em processamento"
        });
        } catch (error) {
        console.error("Erro ao processar o arquivo PDF:", error);
        res.status(500).json({ error: "Erro ao processar o arquivo PDF." });
    }
}