import { Module } from '@nestjs/common';
import { UsersController } from './users/users.controller.js';
import { PostsController } from './posts/posts.controller.js';

@Module({ controllers: [UsersController, PostsController] })
export class AppModule {}
