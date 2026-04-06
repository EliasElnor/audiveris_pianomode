
const uploadArea = document.getElementById('uploadArea');
const pdfInput = document.getElementById('pdfInput');


function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function pdfInputHandler(e) { // Lida com o arquivo PDF selecionado mostrando nome e tamanho
    let file = null;
    if (e.type === 'change') {
        file = e.target.files[0];
    } else if (e.type === 'drop') {
        file = e.dataTransfer.files[0];
    }
    uploadArea.innerHTML = ''; // Limpa área de upload
    const p = document.createElement('p');
    p.textContent = `Arquivo selecionado: ${file.name} (${file.size} bytes)`;
    uploadArea.appendChild(p);
}

uploadArea.addEventListener('click', () => pdfInput.click());

// Eventos para drag and drop e seleção de arquivo
pdfInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        pdfInputHandler(e);
    }
});

uploadArea.addEventListener('drop', (e) => {
    preventDefaults(e);
    const file = e.dataTransfer.files[0];
    if (file) {
        pdfInputHandler(e);
    }
});

// Estilos visuais para drag and drop
uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.style.backgroundColor = '#e9ecef';
});

uploadArea.addEventListener('dragleave', () => {
    uploadArea.style.backgroundColor = 'white';
});

async function confirmPDF() {
    const file = pdfInput.files[0];
    if (!file) {
        alert("Nenhum PDF selecionado.");
    } else {
        const formData = new FormData();
        formData.append('file', file);
        console.log(`PDF confirmado: ${file.name}`);
        try {
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            console.log("Resposta do servidor:", data);
        } catch (error) {
            console.error("Erro ao enviar o PDF:", error);
        }
    }
}