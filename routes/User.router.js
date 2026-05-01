const express = require('express')
const userRouter = express.Router()
const authMiddleware = require('../middlewares/auth.middleware')
const { loginUser, registerUser, getAllUsersExceptAdmin, getSingleUser, updateUser, deleteUser, addAreaToUser, editArea, deleteArea, getAllAreas, updatePasswordByUsername, validatePin, updatePin } = require('../controllers/Auth.controller')


//get emthods 
userRouter.get('/all-users', authMiddleware, getAllUsersExceptAdmin)
userRouter.get('/userById', authMiddleware, getSingleUser)
userRouter.get('/all-areas', getAllAreas)

// //post methods 
userRouter.post('/login', loginUser)
userRouter.post('/new-user', registerUser)
userRouter.post('/update-user', updateUser)
userRouter.post('/add-area', addAreaToUser)
userRouter.put('/edit-area', editArea)
userRouter.post('/update-password', updatePasswordByUsername)
userRouter.post('/update-pin', updatePin)
userRouter.post('/validate-pin', validatePin)
// //delete methods 
userRouter.delete('/delete-user', deleteUser)
userRouter.delete('/delete-area', deleteArea)

module.exports = userRouter