function openNav() {
    const div = document.getElementById('scarlet-woman');
    div.innerHTML = '<iframe src="https://scarletwoman-ai-chat.pages.dev" title="Summon the Scarlet Woman"></iframe>';
    var element = document.getElementById('scarlet-woman-opener');
    // Add the 'hidden' class to trigger the CSS fade-out transition
    element.classList.add('hidden')
    document.getElementById("myNav").style.width = "100%";
}

function closeNav() {
    var element = document.getElementById('scarlet-woman-opener');
    element.classList.remove('hidden');
     // Remove the 'hidden' class to make the button visible again
    const div = document.getElementById('scarlet-woman');
    div.innerHTML = '';
    document.getElementById("myNav").style.width = "0%";
}
