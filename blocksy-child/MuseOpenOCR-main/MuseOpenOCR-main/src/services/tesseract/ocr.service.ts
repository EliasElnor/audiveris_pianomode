import tesseract from 'node-tesseract-ocr';

export function tesseractService(pngPath: string) {
    console.log("Service: Processando o arquivo para tesseractOCR:", pngPath);
    const config = { lang: 'eng', oem: 1, psm: 3 };
    try {

        tesseract.recognize(pngPath, config) //reconhece texto com o tesseract
            .then((text: string) => {
                console.log("Texto extraído com tesseractOCR:");
                console.log(text);
            })
            .catch((error: any) => {
                console.error("Erro ao processar o arquivo com tesseractOCR:", error);
            });
    } catch (error) {
        console.error("Erro inesperado no tesseractService:", error);
    }
}