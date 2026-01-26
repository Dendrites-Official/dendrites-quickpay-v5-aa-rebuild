// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {SimpleAccountFactoryCompat} from "../src/SimpleAccountFactoryCompat.sol";

contract DeployFactoryOnly is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY_DEPLOYER");
        address entryPointAddr = vm.envAddress("ENTRYPOINT");

        vm.startBroadcast(pk);

        SimpleAccountFactoryCompat factory = new SimpleAccountFactoryCompat(IEntryPoint(entryPointAddr));

        vm.stopBroadcast();

        console2.log("NEW_FACTORY=", address(factory));
    }
}
