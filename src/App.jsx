import {
    useState,
    useEffect,
    useRef,
    useCallback,
    useLayoutEffect,
} from 'react';
import React from 'react';
import {BiPlus, BiUser, BiSend, BiSolidUserCircle} from 'react-icons/bi';
import {MdOutlineArrowLeft, MdOutlineArrowRight} from 'react-icons/md';
import { v4 as uuidv4 } from 'uuid';
import Fire from './Fire';
function App() {
    const [text, setText] = useState('');
    const [message, setMessage] = useState(null);
    const [audioUrl, setAudioUrl] = useState(null);
    const [messages, setMessages] = useState([]);
    const [previousChats, setPreviousChats] = useState([]);
    const [localChats, setLocalChats] = useState([]);
    const [currentTitle, setCurrentTitle] = useState(null);
    const [isResponseLoading, setIsResponseLoading] = useState(false);
    const [errorText, setErrorText] = useState('');
    const [isShowSidebar, setIsShowSidebar] = useState(false);
    const [isSidebarParam, setIsSidebarParam] = useState(false);
    const [firstRun, setFirstRun] = useState(true);
    const [id, setId] = useState(uuidv4());
    const scrollToLastItem = useRef(null);
    const createNewChat = () => {
        setAudioUrl(null);
        setMessage(null);
        setText('');
        setCurrentTitle(null);
    };

    const backToHistoryPrompt = (uniqueTitle) => {
        setCurrentTitle(uniqueTitle);
        setMessage(null);
        setText('');
        setAudioUrl(null);
    };

    const toggleSidebar = useCallback(() => {
        setIsShowSidebar((prev) => !prev);
    }, []);


    const inputRef = React.useRef(null);

    const elevenLabsTTS = async (text) => {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/api/generate-audio`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ text }),
        });

        if (!response.ok) {
            throw new Error("Failed to fetch audio");
        }

        const data = await response.json();
        return data.audioUrl;
    };
    const divination = async () => {
        const today = new Date();
        const formattedDate = today.toLocaleDateString('en-US');
        const shortTime = new Intl.DateTimeFormat('en-US', {
            hour: 'numeric',
            minute: 'numeric',
            hour12: true
        }).format(today);
        if (!text && !firstRun) return;

        setIsResponseLoading(true);
        setErrorText('');
        if(firstRun) {
            createNewChat();
            setFirstRun (false);

            setText("Behold, I summon the Scarlet Woman on " + formattedDate + " at " + shortTime + "!");
        }
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': import.meta.env.VITE_AUTH_TOKEN,
            },
            body: JSON.stringify({
                message: (firstRun) ? "Behold, I summon the Scarlet Woman on " + formattedDate + " at " + shortTime + "!" : text,
            }),
        };

        try {
            const response = await fetch(
                `${import.meta.env.VITE_API_URL}/api/completions/` + id,
                options
            );

            if (response.status === 429) {
                setErrorText('Too many requests, please try again later.');
                return;
            }

            const data = await response.json();

            if (data.error) {
                setErrorText(data.error.message);
                setText('');
            } else {
                setErrorText(false);
            }

            if (!data.error) {
                setErrorText('');

                const returnedAudioUrl = await elevenLabsTTS(data.choices[0].message.content);
                setAudioUrl(import.meta.env.VITE_API_URL +  returnedAudioUrl );
                setMessage(data.choices[0].message);
                setMessages((prev) => [
                    ...prev,
                    { role: "user", content: text, audioUrl: null },
                    { role: "assistant", content: data.choices[0].message.content, audioUrl: audioUrl},
                ]);
                setTimeout(() => {
                    scrollToLastItem.current?.lastElementChild?.scrollIntoView({
                        behavior: 'smooth',
                    });
                }, 1);
                setTimeout(() => {
                    setText('');
                }, 2);
            }
        } catch (e) {
            setErrorText(e.message);
            console.error(e);
        } finally {
            setIsResponseLoading(false);
        }
    }

    const submitHandler = async (e) => {
        e.preventDefault();
        //return setErrorText('My billing plan is gone because of many requests.');
        try {
            const elements = document.querySelectorAll('.summon');
            elements.forEach(element => {
                element.remove(); // The Element.remove() method removes the element from its parent node.
            });

            await divination();
        } catch (e) {
            setErrorText(e.message);
            console.error(e);
        } finally {
            setIsResponseLoading(false);
        }
    };

    useLayoutEffect(() => {
        const queryParams = new URLSearchParams(window.location.search);
        setIsSidebarParam(queryParams.get('sidebar') === 'true');

        const handleResize = () => {
            setIsShowSidebar(window.innerWidth <= 640);
        };
        handleResize();

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
        };
    }, []);

  useEffect(() => {
    const storedChats = localStorage.getItem('previousChats');

    if (storedChats) {
      setLocalChats(JSON.parse(storedChats));
      createNewChat();
    }
  }, []);

  useEffect(() => {
    if (!currentTitle && text && message) {
      setCurrentTitle(text);
    }

        if (currentTitle && text && message) {
            const newChat = {
                title: currentTitle,
                role: 'user',
                content: text,
                audioUrl: null,
            };
            const responseMessage = {
                title: currentTitle,
                role: message.role,
                content: message.content,
                audioUrl: audioUrl,
            };

            setPreviousChats((prevChats) => [...prevChats, newChat, responseMessage]);
            setLocalChats((prevChats) => [...prevChats, newChat, responseMessage]);

            const updatedChats = [...localChats, newChat, responseMessage];
            localStorage.setItem('previousChats', JSON.stringify(updatedChats));
        }
    }, [message, currentTitle]);

    const currentChat = (localChats || previousChats).filter(
        (prevChat) => prevChat.title === currentTitle
    );

    const uniqueTitles = Array.from(
        new Set(previousChats.map((prevChat) => prevChat.title).reverse())
    );

    const localUniqueTitles = Array.from(
        new Set(localChats.map((prevChat) => prevChat.title).reverse())
    ).filter((title) => !uniqueTitles.includes(title));

    //makeFlame();
    return (
        <>
            {/*<div className="container">
                <svg xmlns="http://www.w3.org/2000/svg" id="svg" width="400"
                     height="800" preserveAspectRatio viewBox="0 0 400 800">
                </svg>
            </div>*/}
            <div className='container'>
                <section className={`sidebar ${isShowSidebar ? 'open' : ''} ${isSidebarParam ? 'sidebar-param' : ''}`}>
                    <div className='sidebar-header' onClick={createNewChat} role='button'>
                        <BiPlus size={20}/>
                        <button>New Chat</button>
                    </div>
                    <div className='sidebar-history'>
                        {uniqueTitles.length > 0 && previousChats.length !== 0 && (
                            <>
                                <p>Ongoing</p>
                                <ul>
                                    {uniqueTitles?.map((uniqueTitle, idx) => {
                                        const listItems = document.querySelectorAll('li');

                                        listItems.forEach((item) => {
                                            if (item.scrollWidth > item.clientWidth) {
                                                item.classList.add('li-overflow-shadow');
                                            }
                                        });

                                        return (
                                            <li
                                                key={idx}
                                                onClick={() => backToHistoryPrompt(uniqueTitle)}
                                            >
                                                {uniqueTitle}
                                            </li>
                                        );
                                    })}
                                </ul>
                            </>
                        )}
                        {localUniqueTitles.length > 0 && localChats.length !== 0 && (
                            <>
                                <p>Previous</p>
                                <ul>
                                    {localUniqueTitles?.map((uniqueTitle, idx) => {
                                        const listItems = document.querySelectorAll('li');

                                        listItems.forEach((item) => {
                                            if (item.scrollWidth > item.clientWidth) {
                                                item.classList.add('li-overflow-shadow');
                                            }
                                        });

                                        return (
                                            <li
                                                key={idx}
                                                onClick={() => backToHistoryPrompt(uniqueTitle)}
                                            >
                                                {uniqueTitle}
                                            </li>
                                        );
                                    })}
                                </ul>
                            </>
                        )}
                    </div>
                </section>

                <section className='main parent-fire'>
                    <Fire className={isResponseLoading ? 'show' : 'hide'}/>
                    {!currentTitle && (
                        <div className='empty-chat-container'>
                        </div>
                    )}
                    {isSidebarParam ?
                        isShowSidebar ? (
                            <MdOutlineArrowRight
                                className='burger'
                                size={28.8}
                                onClick={toggleSidebar}
                            />
                        ) : (
                            <MdOutlineArrowLeft
                                className='burger'
                                size={28.8}
                                onClick={toggleSidebar}
                            />
                        )
                        : null};
                    <a className='summon' onClick={submitHandler} role='button'><img src='images/summon.jpeg'/></a>
                    <div className='main-header'>
                        <ul>
                            {currentChat?.map((chatMsg, idx) => {
                                const isUser = chatMsg.role === "user";

                                return (
                                    <li key={idx} ref={scrollToLastItem}>
                                        {isUser ? (
                                            <div>
                                                <BiSolidUserCircle size={28.8}/>
                                            </div>
                                        ) : (
                                            <img
                                                className={'scarlet-woman-avatar'}
                                                src="images/scarlet-woman-square.png"
                                                alt="Scarlet Woman"
                                            />
                                        )}
                                        {isUser ? (
                                            <div>
                                                <p className="role-title">You</p>
                                                <p>{chatMsg.content}</p>
                                            </div>
                                        ) : (
                                            <div>
                                                <p className="role-title">Scarlet Woman</p>
                                                <p>{chatMsg.content}</p>
                                                {chatMsg.audioUrl && (
                                                    <audio controls>
                                                        <source src={chatMsg.audioUrl} type="audio/mpeg"/>
                                                        Your browser does not support the audio element.
                                                    </audio>
                                                )}
                                            </div>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>

                    <div className='main-bottom parent-fire'>

                        {errorText && <p className='errorText'>{errorText}</p>}
                        {errorText && (
                            <p id='errorTextHint'>
                            </p>
                        )}
                        <form className='form-container' onSubmit={submitHandler}>
                            <input
                                type='text'
                                placeholder='Send a message.'
                                spellCheck='false'
                                value={isResponseLoading ? 'Divinating...' : text}
                                onChange={(e) => setText(e.target.value)}
                                readOnly={isResponseLoading}
                            />
                            {!isResponseLoading && (
                                <button type='submit' ref={inputRef}>
                                    <BiSend size={20}/>
                                </button>
                            )}
                        </form>
                    </div>
                </section>
            </div>
        </>
    );
}

export default App;
