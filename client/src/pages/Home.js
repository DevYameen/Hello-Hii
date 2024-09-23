import axios from 'axios'
import React, { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { logout, setOnlineUser, setSocketConnection, setUser } from '../redux/userSlice'
import Sidebar from '../components/Sidebar'
import logo from '../assets/logo.png'
import io from 'socket.io-client'

const Home = () => {
  const user = useSelector(state => state.user)
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const location = useLocation()

  // Fetch user details from backend
  const fetchUserDetails = async () => {
    try {
      const URL = `${process.env.REACT_APP_BACKEND_URL}/api/user-details`
      const response = await axios({
        url: URL,
        withCredentials: true,
      })

      dispatch(setUser(response.data.data))

      if (response.data.data.logout) {
        dispatch(logout())
        navigate("/email")
      }

      console.log("Current user details", response.data.data)
    } catch (error) {
      console.error("Error fetching user details:", error)
    }
  }

  useEffect(() => {
    fetchUserDetails()
  }, [])

  // WebSocket connection
  useEffect(() => {
    const socketConnection = io(process.env.REACT_APP_BACKEND_URL, {
      auth: {
        token: localStorage.getItem('token'),  // Ensure token is valid
      },
      transports: ['websocket'],  // Use WebSocket transport
      reconnectionAttempts: 5,    // Number of reconnection attempts
      reconnectionDelay: 5000,    // Delay between reconnections
    })

    socketConnection.on('connect', () => {
      console.log("Socket connected:", socketConnection.id)
    })

    socketConnection.on('connect_error', (error) => {
      console.error("WebSocket connection error:", error)
    })

    socketConnection.on('onlineUser', (data) => {
      console.log("Online users:", data)
      dispatch(setOnlineUser(data))
    })

    // Save socket connection to Redux
    dispatch(setSocketConnection(socketConnection))

    // Clean up on unmount
    return () => {
      console.log("Socket disconnected")
      socketConnection.disconnect()
    }
  }, [])

  const basePath = location.pathname === '/'

  return (
    <div className='grid lg:grid-cols-[300px,1fr] h-screen max-h-screen'>
      {/* Sidebar Section */}
      <section className={`bg-white ${!basePath && "hidden"} lg:block`}>
        <Sidebar />
      </section>

      {/* Message component */}
      <section className={`${basePath && "hidden"}`}>
        <Outlet />
      </section>

      {/* Welcome screen if no user is selected */}
      <div className={`justify-center items-center flex-col gap-2 hidden ${!basePath ? "hidden" : "lg:flex"}`}>
        <div>
          <img src={logo} width={250} alt='logo' />
        </div>
        <p className='text-lg mt-2 text-slate-500'>Select user to send message</p>
      </div>
    </div>
  )
}

export default Home
